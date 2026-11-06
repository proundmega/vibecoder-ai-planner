---
id: "fg-34"
title: "Harness Sandbox and Supply-Chain Security"
status: in_progress
priority: "P0"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-06"
pr: null
branch: "feat/fg-34-sandbox-foundation"
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
- **Slice 1** delivers the sandbox runtime foundation and routes supervisor-driven install/verification commands through it. It does **not** claim full isolation yet: OpenCode still runs in the supervisor, egress is default-deny only, and prompt-injection/supply-chain hardening are later slices.
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
| D5 | Egress allowlist proxy (FR4) and the OpenCode bash-tool bridge into the sandbox (FR11 complete) | fg-34 | Security | fg-34 slice 2 | open |
| D6 | Prompt-injection classification, output scanning and instruction precedence (FR8) | fg-34 | Security | fg-34 slice 3 | open |
| D7 | SBOM, image scanning and digest-pinned base images (FR9) | fg-34 | Supply chain | fg-34 slice 3 | open |
