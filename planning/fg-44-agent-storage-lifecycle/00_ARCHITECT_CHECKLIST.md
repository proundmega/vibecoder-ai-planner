---
id: "fg-44"
title: "Agent Storage Lifecycle and Idle Refresh"
status: in_review
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-22"
pr: 209
branch: "feat/fg-44-storage-lifecycle"
depends_on: ["fg-43", "fg-33", "fg-54"]
---

# 00 — Agent Storage Lifecycle and Idle Refresh (fg-44)

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Implementation in review | `feat/fg-44-storage-lifecycle`; see `03` Results | ☑ |
| Verification results | `03` → Results (agent 959 tests; storage 15; host-storage 12; host-init 78; Compose) | ☑ |

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
are fine. Disk pressure then looks like a code failure.

The existing machinery is partial, not absent: `WorkspaceManager` creates a
random `xxxxxxxx-repo` directory, `HarnessTicketProcessor` destroys the sandbox
and calls the no-arg `cleanup()` in its per-ticket `finally`; the same harness
child (`HarnessTicketProcessor`) runs `pruneStaleWorkspaces()` /
`pruneStaleTempDirectories()` with `HARNESS_WORKSPACE_RETENTION_HOURS` (default
24) and the backend active-path list. What is missing is the runtime/ticket-keyed
layout, lease-safe cleanup, idle/max-lifetime refresh, disk/inode watermarks, a
role budget meter, storage events and a runtime-root/orphan sweep. The existing child/startup temp/
own-root prune stays; the supervisor's `/repos`-rooted legacy pass covers the
old random dirs, and the runtime-root sweep is new. Do not remove
`pruneStaleTempDirectories`: it removes askpass/OpenCode dirs that may contain
credentials.

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Workspace layout | runtime-scoped / current random dirs | `/repos/runtimes/<runtimeId>/<ticketId>/` with `repo/`, `tmp/`, `logs/`; the supervisor owns the runtime root | Answered 2026-11-22: runtime-scoped |
| 2 | Cleanup owner | supervisor / backend reaper / host cron | Supervisor cleans after terminal run + lease release; host script for manual recovery | Answered 2026-11-22: supervisor |
| 3 | Watermarks | five levels / three levels / custom | 70/80/85/90/95 for disk and inodes | Answered 2026-11-22: five levels |
| 4 | Idle refresh | 2h / 4h / off | 2h when no active ticket, lease, sandbox or harness/OpenCode process; the idle runtime child is the process being restarted; same runtime identity | Assumed; revisit after the pilot |
| 5 | Max lifetime | 24h / 12h / off | 24h between tickets | Assumed |
| 6 | Budget breach | fail `storage_budget_exceeded` / warn only | Fail the run, quarantine the workspace, emit an event | Assumed |
| 7 | Reaper owner | supervisor + host script / backend cron | Supervisor periodic sweep + `host-storage.sh` dry-run/apply | Assumed |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Durable leases across restarts | fg-33 | Reliability | fg-33-durable-harness-execution | done (#110) |
| D2 | Sandboxed workspaces | fg-34 | Security | fg-34-harness-sandbox | done for the slices fg-44 needs; fg-34 D12/D24-D26 hardening remains |
| D3 | Per-agent worktrees | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D4 | Host sizing and limits | fg-43 | Infrastructure | fg-43-agent-docker-deployment | done (#197) |
| D5 | Read-only shared dependency cache (npm/Maven) | self | Performance | after the pilot | open |
| D6 | Object-store migration and backup/restore of workspaces | self | Storage | future | open |
| D7 | Cross-host workspace migration | self | Infrastructure | fg-40 | open |
| D8 | Compression of quarantined workspaces | self | Storage | future | open |
| D9 | Configurable sandbox/proxy log rotation (10m/3) | self | Operations | follow-up | open |
| D10 | Retire the supervisor `/repos` legacy pass and migrate `pruneStaleTempDirectories` after the legacy dirs are gone | self | Storage | follow-up | open |
