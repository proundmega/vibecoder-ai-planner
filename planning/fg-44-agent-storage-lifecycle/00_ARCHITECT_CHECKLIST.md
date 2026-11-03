---
id: "fg-44"
title: "Agent Storage Lifecycle and Idle Refresh"
status: planned
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-43", "fg-33"]
---

# 00 — Agent Storage Lifecycle and Idle Refresh (fg-44)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `backend/src/services/PoolManager.js`, `WorkspaceManager`, `agent/Dockerfile`

## Why this ticket exists

Agent containers are long-running and share a `vibecode_repos` volume. Repo clones, `node_modules`, Maven/npm caches, OpenCode temp files, Docker logs and images accumulate. A busy host can fill the 2 TB SSD or exhaust inodes even if CPU/RAM are fine.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Durable leases across restarts | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D2 | Sandboxed workspaces | fg-34 | Security | fg-34-harness-sandbox | open |
| D3 | Per-agent worktrees | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D4 | Host sizing and limits | fg-43 | Infrastructure | fg-43-agent-docker-deployment | open |
