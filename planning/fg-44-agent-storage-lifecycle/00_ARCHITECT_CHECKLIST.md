---
id: "fg-44"
title: "Agent Storage Lifecycle and Idle Refresh"
status: planned
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-22"
pr: null
branch: null
depends_on: ["fg-43", "fg-33", "fg-54"]
---

# 00 — Agent Storage Lifecycle and Idle Refresh (fg-44)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

**Related code:** `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java`,
`agent/src/main/java/com/vibecode/agent/supervisor/Supervisor.java`,
`agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`,
`agent/docker-compose.yml`, `agent/scripts/host-storage.sh` (new).

## Relationship to fg-54 (implemented)

fg-54 replaced per-agent containers with **one supervisor per host** and one
child JVM per declared runtime. This ticket's policy is unchanged, but the unit
is the runtime:

- workspace roots are keyed by `runtime_id`, not `agent_id`;
- idle refresh restarts the child JVM, not a container;
- the orphan reaper compares against active runtimes/runs;
- sandboxes are destroyed before a workspace is deleted.

`PoolManager` no longer exists; any reference in `01`/`02` is historical.

## Why this ticket exists

All runtimes share the repo volume. Repo clones, `node_modules`, Maven/npm
caches, OpenCode temp files, sandbox containers, Docker logs and images
accumulate. A busy host can fill the disk or exhaust inodes even when CPU/RAM
are fine. Disk pressure then looks like a code failure. Today `WorkspaceManager`
creates a random `xxxxxxxx-repo` directory and only has a no-arg `cleanup()`;
nothing cleans a ticket workspace after a terminal run, refreshes an idle
runtime or reaps orphans.

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Workspace layout | runtime-scoped / current random dirs | `/repos/runtimes/<runtimeId>/<ticketId>`; the supervisor owns the runtime root | Answered 2026-11-22: runtime-scoped |
| 2 | Cleanup owner | supervisor / backend reaper / host cron | Supervisor cleans after terminal run + lease release; host script for manual recovery | Answered 2026-11-22: supervisor |
| 3 | Watermarks | five levels / three levels / custom | 70/80/85/90/95 for disk and inodes | Answered 2026-11-22: five levels |
| 4 | Idle refresh | 2h / 4h / off | 2h when no ticket, lease or child process; same runtime identity | Assumed; revisit after the pilot |
| 5 | Max lifetime | 24h / 12h / off | 24h between tickets | Assumed |
| 6 | Budget breach | fail `storage_budget_exceeded` / warn only | Fail the run, quarantine the workspace, emit an event | Assumed |
| 7 | Reaper owner | supervisor + host script / backend cron | Supervisor periodic sweep + `host-storage.sh` dry-run/apply | Assumed |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Durable leases across restarts | fg-33 | Reliability | fg-33-durable-harness-execution | done (#110) |
| D2 | Sandboxed workspaces | fg-34 | Security | fg-34-harness-sandbox | done (fg-34 slices) |
| D3 | Per-agent worktrees | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D4 | Host sizing and limits | fg-43 | Infrastructure | fg-43-agent-docker-deployment | open |
| D5 | Read-only shared dependency cache (npm/Maven) | self | Performance | after the pilot | open |
| D6 | Object-store migration and backup/restore of workspaces | self | Storage | future | open |
| D7 | Cross-host workspace migration | self | Infrastructure | fg-40 | open |
| D8 | Compression of quarantined workspaces | self | Storage | future | open |
