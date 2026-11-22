# 01 — Requirement (fg-44)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

**Related code:** `WorkspaceManager`, `Supervisor`, `SupervisorMain`,
`HarnessTicketProcessor`, `agent/docker-compose.yml`.

## Problem

The fg-54 supervisor runs one child JVM per runtime and shares the repo volume
across them. Every run clones a repo, installs dependencies, writes test output
and may create a sandbox container. Caches, logs and abandoned workspaces
accumulate:

- `WorkspaceManager` creates a random `xxxxxxxx-repo` directory and only has a
  no-arg `cleanup()`; nothing deletes a ticket workspace after a terminal run;
- a killed child leaves its workspace behind;
- an idle runtime keeps its caches and temp files for days;
- sandbox containers and Docker logs add to the same disk;
- there is no disk/inode watermark, budget meter or orphan reaper.

On a 2 TB SSD this is manageable at first, but long-running fleets eventually
hit disk-full, inode exhaustion or slow I/O. Disk pressure then looks like a
code failure.

## Goals

1. Bound the storage each runtime and ticket can consume.
2. Clean a ticket workspace after the run is terminal and the lease is
   released; never delete an active workspace.
3. Refresh an idle runtime after 2h by stopping/restarting the child JVM and
   removing its workspace/caches; keep the runtime identity.
4. Recycle a runtime after 24h between tickets.
5. Detect disk/inode pressure early and stop spawning before the host is
   unusable.
6. Rotate logs and prune dangling images safely.
7. Expose storage events/metrics and a manual recovery script.
8. Destroy the sandbox before deleting its workspace.

## Non-goals

- Distributed storage, NFS or object-store migration (D6).
- Replacing Docker volumes with a CSI driver.
- Sandboxing (fg-34) or host sizing (fg-43).
- Cross-host workspace migration (D7).
- Long-term artifact archival or compression (D8).
- A shared writable cache between runtimes (D5).

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Workspace layout: each runtime owns `/repos/runtimes/<runtimeId>/` and each ticket a subdirectory `<ticketId>/repo`; a runtime never writes into another runtime's root. | Unit test asserts the path for runtime 12/ticket 34; a traversal attempt fails. |
| FR2 | Ticket cleanup: remove the ticket directory only after the run is terminal and the lease is released (success, failure or explicit release). On an unclean JVM exit, preserve it until the fg-33 reaper marks the run terminal; never delete an active workspace. | Cleanup test for success/failure; unclean-exit test keeps the dir until lease expiry. |
| FR3 | Idle refresh: if a runtime has no active ticket/lease/child process for `AGENT_IDLE_REFRESH_MS` (default 2h), stop and restart the child, remove its workspace/caches, keep the same runtime id and refresh the node credential. | Idle test stops/restarts one child, removes the root, keeps the id. |
| FR4 | Max lifetime: recycle a runtime after `AGENT_MAX_LIFETIME_HOURS` (default 24h) only between tickets; never mid-ticket. | Busy runtime is not recycled; idle-at-lifetime is. |
| FR5 | Disk watermarks: 70% warn, 80% stop spawning, 85% clean idle workspaces, 90% emergency recycle oldest idle, 95% manual recovery. Inode usage uses the same thresholds. | Each threshold triggers the expected action; 80% rejects a new claim. |
| FR6 | Budget meter: a periodic `du -sb` + inode count per runtime/ticket; a breach stops the workspace processes, fails the run with `storage_budget_exceeded`, quarantines the workspace and emits an event. | Fixture writes past the worker 20 GB budget; the run fails before the host fills. |
| FR7 | Logs: Docker `json-file` rotation (`max-size=10m`, `max-file=3`) for the supervisor and sandboxes; no unbounded log. | Compose render/inspect asserts the log config. |
| FR8 | Images: prune dangling images only; never prune the current `vibecode-agent`/sandbox tags. | Dry-run lists only dangling images; the active tag remains. |
| FR9 | Orphans: a periodic sweep removes `/repos/runtimes/*` directories not owned by an active runtime/run after `AGENT_WORKSPACE_TTL_HOURS` (default 24h); suspicious dirs move to `orphans/` for a short TTL. | Orphan fixture is reaped after TTL; active/lease-owned dirs are kept. |
| FR10 | Active safety: never delete a workspace or stop a runtime with an unexpired lease or an active child process. | Active lease/process tests skip cleanup and log why. |
| FR11 | Metrics/events: emit workspace bytes, host free bytes/inodes, log size, refresh/cleanup counts and orphan count as fg-41 events or structured logs. | Event/log assertions for each field. |
| FR12 | Recovery: `agent/scripts/host-storage.sh --dry-run|--apply` stops new work, cleans idle workspaces, verifies free space/inodes and never exposes a control token to agents. | Dry-run lists actions; apply frees space; a full-disk fixture recovers. |
| FR13 | Sandbox cleanup: destroy the fg-34 sandbox before deleting its workspace; a failed destroy keeps the runtime tracked and fails closed. | Failed-destroy test keeps the dir; successful test removes it. |

## Storage budget

Use fg-43's per-runtime disk budget:

| Role | Workspace budget | Notes |
|---|---|---|
| worker | 20 GB | repo + node_modules + test output |
| reviewer | 10 GB | read-only checkout |
| planner | 10 GB | planning docs and repo |
| light | 5 GB | small repos/pollers |

Enforce the budget with a periodic `du -sb` plus inode count per runtime/ticket.
On breach: stop the workspace processes, fail the run with
`storage_budget_exceeded`, quarantine under `orphans/`, emit an event and alert.
Docker `storage-opt size` is optional for the container writable layer where the
driver supports it; the shared repo volume relies on the meter.

## Idle refresh policy

- `AGENT_IDLE_REFRESH_MS` = 2h is a **state refresh**, not a pool eviction.
- Eligible only when the runtime has no ticket, no lease, no child process and
  no sandbox.
- Refresh flow: mark `refreshing` (do not assign), capture size, stop the child
  with a grace period, destroy any sandbox, remove the runtime root and caches,
  start a fresh child with the same runtime id, refresh the node credential,
  health check and re-register.
- If refresh fails, keep the old child if it is still running; otherwise mark
  the slot degraded and retry later.
- Log the reason, freed bytes and duration.

## Watermarks

| Usage | Action |
|---|---|
| 70% | warn, emit event |
| 80% | stop spawning new runtimes/tickets; reject a new claim with a clear error |
| 85% | clean idle workspaces/caches; re-run `df` |
| 90% | emergency recycle the oldest idle runtime; alert |
| 95% | stop assigning; require manual recovery |

Inode usage uses the same thresholds. A full disk is not a ticket failure; it
is a host incident.

## Acceptance criteria

1. A ticket workspace is removed after a terminal run and lease release.
2. An unclean JVM exit preserves the workspace until the fg-33 reaper expires
   the lease, then the sweep cleans it.
3. An idle runtime (2h) is recycled and its workspace/cache removed; the
   runtime id and credential survive.
4. An active ticket is never refreshed or cleaned.
5. Disk at 80% stops new claims with a clear error; 90% recycles the oldest
   idle runtime; 95% requires manual recovery.
6. Logs rotate and dangling images are pruned safely.
7. Orphan workspaces are reaped after TTL; active/lease-owned dirs are kept.
8. Storage events show workspace bytes, free bytes/inodes and refresh counts.
9. A full-disk simulation recovers with `host-storage.sh`.
10. A workspace over its profile budget fails the run with
    `storage_budget_exceeded` before the host fills.
11. Sandbox destroy runs before workspace deletion; a failed destroy keeps the
    workspace and fails closed.

## Out of scope

- Automatic workspace migration to another host (D7).
- Deduplicating repo clones across runtimes.
- Compressing or backing up old workspaces (D6/D8).
- A shared read-only dependency cache (D5).

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
