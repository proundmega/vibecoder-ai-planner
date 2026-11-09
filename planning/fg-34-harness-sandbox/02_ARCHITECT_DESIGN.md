# 02_ARCHITECT_DESIGN.md - Harness Sandbox and Supply-Chain Security (fg-34)

## Design summary

Introduce a `SandboxRunner` abstraction between the supervisor and the harness process. The supervisor never runs repo code directly; it asks the runner for a disposable sandbox, mounts the workspace, and receives artifacts on completion.

```
HarnessTicketProcessor (supervisor, outside sandbox)
  -> SandboxRunner.create(SandboxSpec)
       -> container: read-only rootfs, workspace mount, limits, no host socket
       -> network: egress proxy allowlist
       -> secrets: none; provider access via proxy/token broker
  -> OpenCodeClient runs in the supervisor
       -> tool/file calls over the control channel
       -> SandboxRunner.exec / putFile / getFile / stream
  -> artifacts: diff, test output, logs, exit status
  -> SandboxRunner.stop() / destroy()
```

## SandboxSpec

```java
record SandboxSpec(
    String image,
    Path workspace,
    Duration maxDuration,
    int cpus,
    long memoryBytes,
    int pids,
    long diskBytes,
    List<String> allowedHosts,
    Map<String, String> env,
    boolean networkEnabled
) {}
```

## SandboxRunner control channel

`SandboxRunner` is more than create/destroy. It exposes:

```java
SandboxHandle create(SandboxSpec spec);
ExecResult exec(SandboxHandle h, ExecRequest req);      // command, cwd, timeout, output cap
void stream(SandboxHandle h, ExecRequest req, Consumer<Chunk> sink);
void putFile(SandboxHandle h, Path local, String remote);
void getFile(SandboxHandle h, String remote, Path local);
void stop(SandboxHandle h);                             // kill process tree
void destroy(SandboxHandle h);
```

- OpenCode stays in the supervisor so it can call the model/provider proxy and receive events; it never runs repo code directly.
- The model's bash/edit/read tools are translated into `exec`/`putFile`/`getFile` calls. Prompts and event streaming stay on the supervisor side; the untrusted code runs in the sandbox.
- The channel is a per-run Unix socket (or a loopback port bound to 127.0.0.1) with a random per-run token. Repo processes cannot reach it and the sandbox exposes no inbound port. Slice 2 implements the token and loopback binding; request IDs and idempotent exec are **D17**.
- If a future OpenCode build must run inside the sandbox, add an explicit `attach/exec/port` contract and authenticated loopback channel; do not run it without one.

## Runtime

Start with Docker/Podman sibling containers, not Docker-in-Docker:

- `--read-only`, `--tmpfs /tmp`, workspace mounted writable;
- `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges`;
- `--pids-limit`, `--memory`, `--cpus`, `--ulimit`, `--storage-opt size`;
- no `/var/run/docker.sock`, no host network, no privileged;
- seccomp/AppArmor profiles when the platform supports them;
- a hard `docker kill`/process-tree kill on timeout.

MicroVM (Firecracker/Kata) is a future option if containers are not a strong enough boundary.

## Network policy

Default deny. Allow only:

- the package registry hosts required by the repo profile (`npm`, PyPI, Maven Central, etc.);
- an internal artifact cache, if used.

Provider/model calls originate in the supervisor (OpenCode runs outside the sandbox), so no provider host needs to be reachable from repo code. Implement with an egress proxy or network namespace rules, log every denied request, and make the allowlist part of the repo profile rather than the prompt.

Slice 2 implements this with an internal Docker network whose only peer is a hardened allowlist proxy. The sandbox has no default route and external DNS is disabled. For CONNECT tunnels the proxy validates the TLS ClientHello SNI against the allowlisted target and rejects multiple SNI names, extra handshake messages, ECH and missing SNI. CONNECT :80 is rejected; plain HTTP uses per-request absolute-form validation. Only the first ClientHello is inspected: TLS renegotiation and the encrypted HTTP `Host` inside a TLS tunnel are not visible without TLS termination, so a shared-CDN tenant with the same allowlisted SNI remains a limitation (**D16**).

## Secrets

- The sandbox gets no long-lived credentials.
- Provider calls go through a local proxy that injects the key outside the sandbox, or through a short-lived scoped token.
- GitHub publishing happens in the supervisor after artifacts are extracted; the sandbox has no push credential.
- Test configuration may include non-secret DB URLs and feature flags, never passwords.

## Prompt-injection defenses

- Treat repo files, issue text and PR comments as untrusted data.
- Put system/developer instructions above repository content; tell the model that repo text cannot change its rules. `PromptBuilder` wraps ticket and planning content in `<untrusted-content>` blocks and escapes the closing tag; the security section states that the supervisor instructions and publishing policy take precedence.
- Deny literal reads of `.env*`, `secrets/**`, `.git/config`, `.ssh/**`, `.aws/**`, `.npmrc`, `.netrc` and host paths through the OpenCode read permission. This is not a secret boundary: OpenCode's read tool follows symlinks and its grep tool bypasses path rules (**D18**). Grep is denied in sandboxed mode and `sandbox_bash rg` is used instead as a partial mitigation. Host mode is explicitly not a security boundary.
- Scan commands for high-confidence exfiltration (`curl`/`wget` uploads, netcat/socat, remote copy, shell `/dev/tcp`, common credential-file reads) and deny them in the bash bridge. This is a partial denylist: interpreter one-liners, encoded payloads and unlisted tools can bypass it.
- Scan the guarded tree's added/modified blob contents and new paths before publishing, not `git diff` output. This prevents `.gitattributes`/binary/`++`-prefix/filename bypasses, compares content matches against the base blob so pre-existing fixtures do not block unrelated edits, compares complete PEM private-key blocks (case-insensitive BEGIN/END markers, exact block comparison so reformatting a pre-existing key counts as new), exposes new gitlink paths, and fails closed on an oversized blob. It refuses a configured provider key/GitHub token or a high-confidence credential format. The scan is defense in depth and cannot detect every encoded leak.
- Keep the publishing guard independent of the model.

## Supply chain

- Pin base images by digest; rebuild on a schedule. All `FROM` images in `agent/Dockerfile`, `agent/sandbox.Dockerfile` and `agent/sandbox-proxy.Dockerfile` are digest-pinned; `agent/scripts/sandbox-image-security.sh --check-pins` is the deterministic gate (CI runs it even when scanners are unavailable).
- Generate an SBOM per image (`--sbom`, syft/SPDX JSON under `agent/target/sbom/`); scan OS packages and language dependencies (`--scan`, trivy or grype, HIGH/CRITICAL by default). `--all` optionally verifies a cosign signature when `COSIGN_PUBLIC_KEY` is set.
- Use lockfiles and `npm ci`/equivalent where possible. The harness already uses `npm ci` when a lockfile exists and `--no-package-lock` otherwise.
- Consider `--ignore-scripts` as the default, with an explicit profile opt-in for repos that need lifecycle scripts. Lifecycle scripts currently run inside the sandbox; fg-39 repo profiles will own the opt-out.
- Keep the image minimal; no shell utilities that are not required.

## Artifact extraction

- Compute the diff inside the sandbox but validate it outside against the expected branch/base.
- Copy test output and logs through a bounded artifact directory.
- Redact configured secrets and high-confidence credential formats before persistence (branch names, ticket messages, run errors, commit/PR titles and PR bodies); scope is the OpenCode supervisor path (legacy processors and external log shipping are D19). Treat redaction as a storage guard, not a sandbox boundary.
- Verify no symlinks or paths escape the workspace.
- Destroy the sandbox even on failure; retain only artifacts.

## Local development

- `SANDBOX_MODE=host` for Windows/dev, with a startup warning and no production default.
- `SANDBOX_MODE=docker` for Linux/dev and CI.
- CI must run at least one sandboxed smoke test so the Dockerfile and runtime stay valid.

## Tests

- malicious `postinstall` and test scripts;
- path traversal and symlink escape;
- host path and metadata endpoint access;
- network allow/deny;
- CPU/memory/PID/disk/timeout enforcement;
- secret absence;
- artifact extraction and diff validation;
- sandbox creation failure (fail closed).

## Rollout

1. Add the runner with `SANDBOX_MODE=host` to preserve current behavior.
2. Enable Docker sandbox in CI.
3. Enable per-project in staging; compare failure rates.
4. Make Docker the production default; keep host mode only for local dev.
5. Add image signing/SBOM gates.

## Open questions

1. Docker sibling vs Podman vs microVM for the first version?
2. How do we proxy model traffic without leaking the key into the sandbox?
3. Do we allow lifecycle scripts at all?
4. How do we support repos that need Docker (e.g. testcontainers) without exposing the host socket?
5. What is the disk quota per repo?

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
