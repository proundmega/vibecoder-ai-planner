# 01_ARCHITECT_REQUIREMENT.md - Harness Sandbox and Supply-Chain Security (fg-34)

**Related code:** `OpenCodeClient`, `HarnessTicketProcessor`, `agent/Dockerfile`, OpenCode config permissions

## Problem

The harness executes untrusted repository content. A cloned repo can contain:

- malicious `package.json` lifecycle scripts (`preinstall`, `postinstall`);
- test suites that read files, spawn processes, or exfiltrate data;
- symlinks and path traversal;
- prompt injection in `AGENTS.md`, README files, issue text, or PR comments;
- `git` hooks or tool configuration that executes on checkout;
- build scripts that consume the network or write outside the workspace.

Phase 1 relies on OpenCode config denies (`git push`, `rm -rf`, `docker`, etc.) and prompt instructions. That is a policy layer, not a security boundary. The agent container also inherits a writable filesystem, a network, and potentially a Docker socket in local development.

## Goals

1. Run each ticket in an isolated, disposable sandbox with no host access.
2. Enforce CPU, memory, PID, disk and wall-clock limits.
3. Restrict network egress to the minimum required endpoints.
4. Make the sandbox secretless; inject only non-secret test configuration.
5. Harden the harness against prompt injection and malicious repo instructions.
6. Capture artifacts (diff, test output, logs) without giving the sandbox a path back to the host.
7. Support local development without weakening the production boundary.
8. Make supply-chain artifacts visible: SBOM, image scan, pinned base images.

## Non-goals

- Protecting against a compromised container runtime or kernel exploit.
- Fully offline model inference.
- Running arbitrary user-supplied containers.
- Replacing the publishing guard (fg-30) or review (fg-31).

## Functional requirements

- **FR1 - Runtime:** launch a per-ticket sandbox from a pinned image; destroy it after the run.
- **FR2 - Limits:** CPU, memory, PID count, disk quota, open files, and max runtime; kill the process tree on breach.
- **FR3 - Filesystem:** only the workspace is writable; the base image is read-only; no host bind mounts except the workspace; no host Docker socket.
- **FR4 - Network:** default deny; allow only approved package registries and an internal artifact cache, via an egress proxy with logging. Provider/model calls stay in the supervisor, outside the sandbox. Implemented with an internal Docker network whose only peer is a hardened allowlist proxy; the sandbox has no default route and no external DNS. The proxy validates the first CONNECT ClientHello SNI against the allowlisted target, rejects multiple SNI names/extra handshakes/ECH/missing SNI, and rejects CONNECT :80 (plain HTTP uses per-request absolute-form validation). TLS renegotiation and the encrypted inner TLS Host are D16.
- **FR5 - Secrets:** no provider keys, GitHub tokens, DB passwords or agent API keys inside the sandbox; provider calls happen in the supervisor via a scoped proxy, and the sandbox holds no credentials.
- **FR6 - User:** non-root, no-new-privileges, dropped capabilities, seccomp/AppArmor profile where available.
- **FR7 - Artifacts:** Extract diff, verification output and logs through an explicit artifact channel. The disposable clone may be writable, but the host repository is never mounted writable and only the supervisor's publishing guard decides what is published.
- **FR8 - Prompt-injection defense:** label repo content as untrusted, enforce instruction precedence, deny secret access, and scan outputs for suspicious commands/exfiltration. The supervisor labels ticket/planning/repository content, denies literal reads of `.env*`/`secrets/**`/`.git/config`/SSH/cloud credential files, blocks high-confidence credential-read and network-upload commands on the bash bridge, and refuses to publish a guarded-tree blob whose content or new path contains a configured credential or a high-confidence credential format. Matches already present in the base blob are ignored so pre-existing fixtures do not block unrelated edits, while complete PEM private-key blocks are compared as a whole (case-insensitive BEGIN/END markers, exact block comparison) so a new key block with a reused or differently-cased header is still caught. The read deny is not a secret boundary: symlink and grep bypasses are **D18**, and grep is denied in sandboxed mode as a partial mitigation. Prompt injection remains probabilistic; the sandbox and publishing guard are the boundary.
- **FR9 - Supply chain:** SBOM, image scan, signed/pinned base image, lockfile-aware installs. Every base image in the supervisor, sandbox and proxy Dockerfiles is pinned by digest; `agent/scripts/sandbox-image-security.sh --check-pins` enforces the pin gate case-insensitively (UTF-8 BOM/CRLF tolerant, digest required on the image token, stage references skipped), generates an SPDX SBOM with syft, scans with trivy/grype at a HIGH/CRITICAL threshold, and optionally verifies a cosign signature. Node installs use `npm ci` when a lockfile exists and never create a lockfile. Lifecycle scripts run inside the sandbox; a repo-profile opt-out is fg-39.
- **FR10 - Local mode:** a clearly labeled `SANDBOX_MODE=host` for Windows/dev. During the Phase 1 rollout it remains the code default with a loud warning; production must set `SANDBOX_REQUIRE=true`, which refuses host mode.
- **FR11 - Control channel:** supervisor↔sandbox exec/file/stream API over a per-run authenticated local channel; OpenCode stays in the supervisor, repo code cannot reach the channel, and the sandbox exposes no inbound ports. Slice 2 provides a loopback, per-run-token bridge for the model's shell commands (the built-in `bash`/`shell` tools are disabled and `sandbox_bash` forwards into the sandbox). Streaming output is D15; request IDs/idempotency are D17.

## Non-functional requirements

- **NFR1 - Escape containment:** a sandbox escape must not expose the host workspace, credentials or other tickets.
- **NFR2 - No internal reachability:** a malicious test must not be able to reach the planner backend or metadata service.
- **NFR3 - Supervisor-only secrets:** the OpenCode server password and provider key remain outside the sandbox.
- **NFR4 - Process-tree kill:** killing a sandbox must kill all descendant processes.
- **NFR5 - Redaction:** sandbox logs must be redacted before storage.
- **NFR6 - Fail closed:** failed sandbox creation or pre-publish destruction must fail closed; never fall back silently to host execution in production, and never stage or push with a live sandbox.
- **NFR7 - Non-root boundary:** the sandbox runs as a non-root user with no-new-privileges and dropped capabilities.

## Acceptance criteria

1. A test that attempts to read `../`, a host path, or a metadata endpoint fails.
2. A test that attempts network access to a non-allowlisted host is blocked and logged.
3. CPU/memory/PID/disk breaches kill the run and mark it failed.
4. No provider key or GitHub token is visible inside the sandbox.
5. A malicious `postinstall`-style script runs contained; its background children are swept after each command, but the documented fork-race window can persist until the pre-publish destroy (D14). The destroy gate prevents publishing with a live sandbox.
6. The diff and test output are extracted correctly.
7. The sandbox image has a SBOM and passes the scanner threshold.
8. Host mode is the Phase 1 compatibility default, warns loudly, and production sets `SANDBOX_REQUIRE=true`, which refuses it.

## Out of scope

- Multi-tenant kernel isolation beyond the chosen runtime.
- GPU sandboxing.
- Malware analysis of the repo.
- Windows containers in production.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
