---
id: "fg-34"
title: "Harness Sandbox and Supply-Chain Security"
status: in_progress
priority: "P0"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-06"
pr: 127
branch: "feat/fg-34-slice-2-egress-bridge"
depends_on: ["fg-30"]
---

# 00 — Harness Sandbox and Supply-Chain Security (fg-34)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `OpenCodeClient`, `HarnessTicketProcessor`, `agent/Dockerfile`

## Why this ticket exists

Phase 1 runs OpenCode with `bash` access in a cloned repo on the agent container. Config deny-lists and prompt rules are not isolation: repo code, build scripts, tests and `npm install` lifecycle scripts can execute arbitrary code, reach the network, or read whatever the agent container can read.

## Scope decisions

- **Rollout:** `SANDBOX_MODE=host` remains the Phase 1 compatibility default. Docker mode is opt-in, and a Docker create/exec failure never falls back to host execution.
- **Slice 1** delivers the sandbox runtime foundation and routes supervisor-driven install/verification commands through it.
- **Slice 2** adds the egress allowlist proxy (FR4) and bridges the OpenCode bash tool into the sandbox (FR11). The built-in `bash`/`shell` tool is disabled in Docker mode; the model uses `sandbox_bash`, which forwards over a per-run loopback token. The proxy validates the first CONNECT ClientHello SNI, rejects multiple SNI names/duplicate extensions/extra handshakes, rejects CONNECT :80, blocks external DNS, and logs denials only. TLS renegotiation and the encrypted inner HTTP Host inside TLS remain shared-CDN limitations (D16), and output streaming/idempotency are D15/D17.
- It does **not** claim full isolation yet: prompt-injection/supply-chain hardening are later slices. Do **not** enable Docker mode for untrusted repositories until D14 (bounded repeated 5-pass/fork-race descendant sweep) is closed, and do not treat the allowlist as a hard host boundary until D16 is closed; the pre-publish destroy gate prevents publishing with a live sandbox, but a survivor can write before that gate.
- **Deployment:** Docker mode needs a daemon connection and a workspace path visible to the host. `PoolManager`/compose wiring is deferred to D8; slice 1 requires a manually run host agent (or equivalent path mapping).
- **Remaining slices** are tracked in `03_ARCHITECT_IMPLEMENTATION.md` and the deferred register below.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Run recovery with sandbox state | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D2 | Short-lived GitHub App tokens instead of PATs | fg-35 | Security | fg-35-github-app-credentials | open |
| D3 | Repo-specific images and caches | fg-39 | Infrastructure | fg-39-repo-environment-profiles | open |
| D4 | Data redaction before model calls | fg-42 | Privacy | fg-42-harness-privacy | open |
| D5 | Egress allowlist proxy (FR4) and the OpenCode bash-tool bridge into the sandbox (FR11 complete) | fg-34 | Security | fg-34 slice 2 | in review (#127) |
| D6 | Prompt-injection classification, output scanning and instruction precedence (FR8) | fg-34 | Security | fg-34 slice 3 | open |
| D7 | SBOM, image scanning and digest-pinned base images (FR9) | fg-34 | Supply chain | fg-34 slice 3 | open |
| D8 | Docker sandbox deployment wiring: `PoolManager` env, socket proxy/DOCKER_HOST and a host-visible repo volume | fg-34 | Infrastructure | fg-34 slice 2 / fg-43 | open |
| D9 | Startup reaper for sandbox containers left by a killed agent (the slice-1 shutdown hook covers graceful exit only) | fg-34 | Reliability | fg-34 slice 2 | open |
| D10 | Race-free artifact copy: the Docker file channel rejects failures by exit code, but `docker cp` and the reported size remain untrusted; a same-container swap/spoof is possible | fg-34 | Security | fg-34 slice 2 | open |
| D11 | Redaction before storage (NFR5): sandbox/verification output is bounded but not separately redacted | fg-34 | Privacy | fg-34 slice 3 | open |
| D12 | True disk quota: the supervisor walk cannot see unlinked-but-open files; a quota-enabled volume/filesystem is the durable fix | fg-34 | Reliability | fg-34 slice 2 | open |
| D13 | CI builds and smoke-tests `agent/sandbox.Dockerfile`; the integration suite currently uses `SANDBOX_IT_IMAGE` (e.g. `redis:7-alpine`) | fg-34 | Testing | fg-34 slice 2 | open |
| D14 | Post-exec descendant sweep is bounded and repeated but still best-effort; a process forking during the final pass can survive until the pre-publish destroy. Ephemeral containers/process namespaces or a confirmed quiescent sweep are the hard guarantee | fg-34 | Security | fg-34 slice 2 | open |
| D15 | Streaming exec output over the sandbox control channel (FR11): the bridge currently buffers each command's bounded output. A streaming API is needed for long installs and live progress | fg-34 | UX/Reliability | fg-34 slice 3 | open |
| D16 | TLS renegotiation and the encrypted HTTP Host inside a CONNECT tunnel are not visible without TLS termination. The proxy validates only the first ClientHello (multiple SNI names/extra handshakes are rejected); a later renegotiation ClientHello or a shared-CDN tenant that serves the same allowlisted SNI can still be reached. Dedicated hosts or proxy TLS termination would close this | fg-34 | Security | fg-34 slice 3 | open |
| D17 | Bridge request IDs/idempotency: the bridge has no request ID or result cache, so a lost HTTP response can lead to a re-executed command. A stable request ID and bounded idempotency cache are needed | fg-34 | Reliability | fg-34 slice 3 | open |
