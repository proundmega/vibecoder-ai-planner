# 02_ARCHITECT_DESIGN.md - Harness Sandbox and Supply-Chain Security (fg-34)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1

## Design summary

Introduce a `SandboxRunner` abstraction between the supervisor and the harness process. The supervisor never runs repo code directly; it asks the runner for a disposable sandbox, mounts the workspace, and receives artifacts on completion.

```
HarnessTicketProcessor
  -> SandboxRunner.create(SandboxSpec)
       -> container: read-only rootfs, workspace mount, limits, no host socket
       -> network: egress proxy allowlist
       -> secrets: none; provider access via proxy/token broker
  -> OpenCodeClient runs inside sandbox
  -> artifacts: diff, test output, logs, exit status
  -> SandboxRunner.destroy()
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

- the configured model/provider host(s);
- the package registry hosts required by the repo profile (`npm`, PyPI, Maven Central, etc.);
- an internal artifact cache, if used.

Implement with an egress proxy or network namespace rules, log every denied request, and make the allowlist part of the repo profile rather than the prompt.

## Secrets

- The sandbox gets no long-lived credentials.
- Provider calls go through a local proxy that injects the key outside the sandbox, or through a short-lived scoped token.
- GitHub publishing happens in the supervisor after artifacts are extracted; the sandbox has no push credential.
- Test configuration may include non-secret DB URLs and feature flags, never passwords.

## Prompt-injection defenses

- Treat repo files, issue text and PR comments as untrusted data.
- Put system/developer instructions above repository content; tell the model that repo text cannot change its rules.
- Deny reading `.env*`, `secrets/**`, `.git/config` and host paths.
- Scan model output for suspicious commands (`curl | sh`, credential paths) and post-run diffs for exfiltration patterns.
- Keep the publishing guard independent of the model.

## Supply chain

- Pin base images by digest; rebuild on a schedule.
- Generate an SBOM per image; scan OS packages and language dependencies.
- Use lockfiles and `npm ci`/equivalent where possible.
- Consider `--ignore-scripts` as the default, with an explicit profile opt-in for repos that need lifecycle scripts.
- Keep the image minimal; no shell utilities that are not required.

## Artifact extraction

- Compute the diff inside the sandbox but validate it outside against the expected branch/base.
- Copy test output and logs through a bounded artifact directory.
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

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-35 | Short-lived GitHub App tokens | Security | `fg-35-github-app-credentials` | No |
| 2 | fg-42 | Sensitive-data redaction | Privacy | `fg-42-harness-privacy` | No |
| 3 | fg-39 | Repo-specific images and caches | Infrastructure | `fg-39-repo-environment-profiles` | No |
| 4 | fg-33 | Run recovery with sandbox state | Reliability | `fg-33-durable-harness-execution` | No |
