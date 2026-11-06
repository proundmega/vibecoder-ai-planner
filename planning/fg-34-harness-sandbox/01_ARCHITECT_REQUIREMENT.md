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
- **FR4 - Network:** default deny; allow only approved package registries and an internal artifact cache, via an egress proxy with logging. Provider/model calls stay in the supervisor, outside the sandbox.
- **FR5 - Secrets:** no provider keys, GitHub tokens, DB passwords or agent API keys inside the sandbox; provider calls happen in the supervisor via a scoped proxy, and the sandbox holds no credentials.
- **FR6 - User:** non-root, no-new-privileges, dropped capabilities, seccomp/AppArmor profile where available.
- **FR7 - Artifacts:** Extract diff, verification output and logs through an explicit artifact channel. The disposable clone may be writable, but the host repository is never mounted writable and only the supervisor's publishing guard decides what is published.
- **FR8 - Prompt-injection defense:** label repo content as untrusted, enforce instruction precedence, deny secret access, and scan outputs for suspicious commands/exfiltration.
- **FR9 - Supply chain:** SBOM, image scan, signed/pinned base image, lockfile-aware installs.
- **FR10 - Local mode:** a clearly labeled `SANDBOX_MODE=host` for Windows/dev. During the Phase 1 rollout it remains the code default with a loud warning; production must set `SANDBOX_REQUIRE=true`, which refuses host mode.
- **FR11 - Control channel:** supervisor↔sandbox exec/file/stream API over a per-run authenticated local channel; OpenCode stays in the supervisor, repo code cannot reach the channel, and the sandbox exposes no inbound ports. Slice 1 provides exec/file over the local control path; the per-run token, streaming and the OpenCode bash bridge are slice 2.

## Non-functional requirements

- **NFR1 - Escape containment:** a sandbox escape must not expose the host workspace, credentials or other tickets.
- **NFR2 - No internal reachability:** a malicious test must not be able to reach the planner backend or metadata service.
- **NFR3 - Supervisor-only secrets:** the OpenCode server password and provider key remain outside the sandbox.
- **NFR4 - Process-tree kill:** killing a sandbox must kill all descendant processes.
- **NFR5 - Redaction:** sandbox logs must be redacted before storage.
- **NFR6 - Fail closed:** failed sandbox creation must fail closed; never fall back silently to host execution in production.
- **NFR7 - Non-root boundary:** the sandbox runs as a non-root user with no-new-privileges and dropped capabilities.

## Acceptance criteria

1. A test that attempts to read `../`, a host path, or a metadata endpoint fails.
2. A test that attempts network access to a non-allowlisted host is blocked and logged.
3. CPU/memory/PID/disk breaches kill the run and mark it failed.
4. No provider key or GitHub token is visible inside the sandbox.
5. A malicious `postinstall`-style script runs contained and its background children cannot persist beyond the command.
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
