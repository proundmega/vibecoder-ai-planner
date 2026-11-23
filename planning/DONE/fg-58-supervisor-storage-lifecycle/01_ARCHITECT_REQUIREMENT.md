# 01 — Requirement (fg-58)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

PR #209 added the fg-44 workspace/recovery foundation but the supervisor still
does not run the storage lifecycle:

- `StoragePolicy.lifetimeExpired` / `CLEAN_IDLE` are policy-only; no runtime is
  refreshed.
- 85/90/95 actions only log; the supervisor never cleans idle roots, recycles
  the oldest child or stops assigning beyond the immediate spawn guard.
- Inode usage is never sampled (`Usage` is `(usedPct, 0)`).
- The periodic runtime-root/legacy/orphan sweep and quarantine are manual only;
  `workspaceTtl`/`orphanTtl` are unused.
- Storage events are incomplete: no `storage.workspace`, `storage.refresh`,
  `storage.watermark`, `storage.orphan`, `storage.image_prune` or
  `storage.log_bytes`.
- The budget is checked once after clone, not periodically, and a breach clears
  the workspace instead of quarantining it.
- `host-storage.sh` treats any PID file/`.active` marker as live, so stale state
  blocks recovery.
- `WorkspaceManager.cleanupRuntime()` could delete a legacy manager rooted at
  `/repos`.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Idle refresh: an idle runtime with no `.active` marker, active slot, lease, sandbox or harness is stopped, its runtime root removed and a fresh child started with the same runtime id after `AGENT_IDLE_REFRESH_MS` (2h). | Idle fixture refreshes one child; active marker/ticket is untouched. |
| FR2 | Max lifetime: recycle only between tickets after `AGENT_MAX_LIFETIME_HOURS` (24). | Busy runtime is not recycled; idle at lifetime is. |
| FR3 | Watermarks: sample disk and inode usage every `AGENT_STORAGE_CHECK_SECONDS`; 70 warn/event, 80 stop spawn, 85 clean idle roots, 90 recycle oldest idle, 95 manual recovery/stop assignment. | Each level produces its action and event/log; inode sampling is active. |
| FR4 | Periodic sweep: runtime roots, `/repos/<8hex>-*` legacy dirs and temp dirs are reaped after `HARNESS_WORKSPACE_RETENTION_HOURS`; suspicious dirs move to `/repos/orphans/` for `AGENT_ORPHAN_TTL_HOURS`. | Fixtures for each root are removed/quarantined; active/lease-owned dirs are kept. |
| FR5 | Events: `storage.workspace`, `storage.refresh`, `storage.refresh_failed`, `storage.watermark`, `storage.orphan`, `storage.image_prune` and `storage.log_bytes` are emitted with redacted payloads. | Event sink test asserts every type/payload. |
| FR6 | Budget: a periodic `du`/inode meter per runtime/ticket; a breach fails the run with `storage_budget_exceeded`, stops workspace processes, quarantines the directory and emits the event. | Fixture over budget quarantines instead of deleting. |
| FR7 | Host recovery: `host-storage.sh` treats a PID file as live only when the PID exists and a `.active` marker as live only within retention; stale state permits `--apply`. | Fresh live state exits 4; stale fixtures apply. |
| FR8 | Runtime-root deletion guard: `cleanupRuntime()` refuses a legacy/base root (`/repos` or a directory named `repos`) and only deletes a runtime root. | Base-root fixture is refused; runtime fixture is removed. |

## Out of scope

Kubernetes, object storage, cross-host migration, shared writable caches and
Docker Desktop specifics.
