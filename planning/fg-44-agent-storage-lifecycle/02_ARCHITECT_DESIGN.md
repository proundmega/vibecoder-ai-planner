# 02 — Design (fg-44)

> **Owns:** current-state audit, design, data flow, contracts, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file operations
> (`04`), status and deferrals (`00`).

## Current State

- `WorkspaceManager(repoCloneDir, repoName, ...)` clones into a random
  `<8hex>-<repo>` directory under `REPO_CLONE_DIR`; it has a no-arg `cleanup()`.
- `HarnessTicketProcessor` calls that `cleanup()` in the per-ticket `finally`
  after destroying the sandbox; the same harness child also runs
  `pruneStaleWorkspaces()` / `pruneStaleTempDirectories()` with
  `HARNESS_WORKSPACE_RETENTION_HOURS` (default 24) and the backend active-path
  list. This is random-dir cleanup, not runtime/ticket-keyed lifecycle
  management.
- The fg-54 supervisor spawns one child per runtime and passes
  `REPO_CLONE_DIR` (default `/repos`); children share the same root.
- `HarnessTicketProcessor` owns the clone, the sandbox and the finish path, so
  it is the natural cleanup caller.
- There is no idle-refresh timer, disk/inode watermark, role budget meter,
  runtime-root sweep or `host-storage.sh`. The existing child/startup temp/
  own-root prune stays; the supervisor's `/repos`-rooted legacy pass covers the
  old random dirs, and the runtime-root sweep is new. D10 retires the one-time
  legacy path.
- The supervisor Compose service already has `json-file` rotation 10m/3; the
  sandbox/proxy containers are created by `DockerSandboxRunner` with bounded
  1m/1 and are not Compose services.

## Design summary

```
Supervisor
  -> child env REPO_CLONE_DIR=/repos/runtimes/<runtimeId>
  -> child WorkspaceManager clones <ticketId>/repo
  -> HarnessTicketProcessor finishes (terminal + lease release)
       -> destroy sandbox
       -> WorkspaceManager.cleanup(ticketId)
  -> idle 2h / max 24h between tickets:
       -> stop child, destroy sandbox, remove runtime root, restart child
       -> same runtime id + refreshed node credential
  -> periodic storage sweep:
       -> du/inode meter, watermarks, runtime-root + legacy/temp pass, orphan
          reaper, dangling images
  -> host-storage.sh (dry-run/apply) for manual recovery
```

## Workspace layout

```
/repos/
  runtimes/
    <runtimeId>/
      <ticketId>/
        repo/
        tmp/
        logs/
      cache/            # per-runtime npm/m2/OpenCode temp, TTL-bound
  orphans/
    <runtimeId>-<ticketId>-<timestamp>/
```

- `REPO_CLONE_DIR=/repos/runtimes/<runtimeId>` is passed by the supervisor to
  each child. The child never writes outside its runtime root.
- `WorkspaceManager` gains a `workspaceKey` (the ticket id, sanitized) and
  creates `<runtimeRoot>/<ticketId>/repo`. A no-ticket task (profile
  validation) uses `<uuid>/repo`.
- `cleanup(ticketId)` deletes only `<runtimeRoot>/<ticketId>`; a
  `cleanupRuntime()` deletes the runtime root; the existing no-arg `cleanup()`
  remains as a full shutdown wrapper.
- `assertSafeToDelete` currently uses `toAbsolutePath().normalize()`. fg-44
  changes it to `toRealPath(LinkOption.NOFOLLOW_LINKS)` for an existing path
  (and a normalized, non-following check for a path that does not exist yet),
  refusing anything outside the runtime root.

## Cleanup flow

1. The run reaches `succeeded`, `failed`, `budget_exceeded` or `dead_letter`.
2. `HarnessTicketProcessor` destroys the sandbox (if any) and verifies the
   destroy/close result.
3. It records the final checkpoint/finish (lease release).
4. Only after the lease release, it calls `WorkspaceManager.cleanup(ticketId)`;
   cleanup deletes the ticket root including `.active`. On failure, the marker
   remains for the sweep.
5. On failure, it preserves the workspace and `.active` marker and emits a
   `storage.cleanup_failed` event; the orphan sweep retries after TTL. A marker
   whose run is terminal and whose lease has expired is stale only after the
   retention TTL.
6. On an unclean JVM exit, the workspace stays until the fg-33 reaper marks the
   run terminal and the lease expires; the storage sweep then removes it.

Cleanup is idempotent and never touches a directory with an active workspace
lock. `HarnessTicketProcessor` writes `<ticketRoot>/.active` at run start; the
successful `cleanup(ticketId)` deletes the ticket root including the marker. A
failed cleanup leaves the marker for the sweep. The supervisor slot and the
marker are both checked. `host-storage.sh` uses the same marker/PID state in
stopped-supervisor mode.

## Idle refresh and max lifetime

- The supervisor tracks `lastActivityAt` per runtime (last claim/finish).
- `AGENT_IDLE_REFRESH_MS` default `7200000` (2h); `AGENT_MAX_LIFETIME_HOURS`
  default `24`.
- Eligible only if no active ticket, no lease, no sandbox and no active
  harness/OpenCode process. The idle runtime child JVM is the process being
  restarted.
- Flow: mark `refreshing` (not assignable), capture size, stop the child with
  `SUPERVISOR_STOP_TIMEOUT_SECONDS`, destroy the sandbox, remove the runtime
  root and caches, start a fresh child with the same runtime id, refresh the
  node credential, health check and re-register.
- If the restart fails after the child was stopped, mark the slot `degraded`,
  emit `storage.refresh_failed` and retry with backoff. Do not claim the old
  child is still running; it was stopped. If the remove step failed before
  deletion, keep the workspace for recovery and retry.
- A max-lifetime refresh uses the same flow but only between tickets.

## Watermarks

The supervisor samples the repo volume (`statfs`) every
`AGENT_STORAGE_CHECK_SECONDS` (default 60):

| Usage | Action |
|---|---|
| 70% | warn + `storage.watermark` event |
| 80% | stop spawning; reject new claims with `STORAGE_PRESSURE` |
| 85% | clean idle runtime roots/caches; re-sample |
| 90% | emergency recycle the oldest idle runtime; alert |
| 95% | stop assigning; require `host-storage.sh --apply` with the supervisor stopped |

Inode usage uses the same thresholds. The backend exposes the current state via
the existing heartbeat/status payload so the fleet UI can show it.

## Budget meter

- Every `AGENT_STORAGE_METER_SECONDS` (default 300), walk the active runtime
  roots with `du -sb` and count inodes (bounded depth; skip `.git` objects if
  needed).
- Compare against the resolved per-runtime budget: the role default (worker
  20 GB, reviewer/planner 10 GB, light 5 GB) or the fg-43 override
  `AGENT_DISK_BUDGET_GB`. fg-44 makes `host-init.sh` write the override to
  `.env.agent-host`; it also writes `HARNESS_WORKSPACE_RETENTION_HOURS`, so the
  supervisor sees the operator TTL. The supervisor passes the resolved budget
  to the child. `StoragePolicy`/`RuntimeState` carry the role and budget; do
  not add a second `AGENT_WORKSPACE_BUDGET_GB` knob.
- On breach: send `SIGTERM` to the workspace child/sandbox, fail the run with
  `storage_budget_exceeded`, move the ticket dir to `orphans/`, emit an event
  and alert.
- The meter is best-effort and never blocks the supervisor loop; a slow scan is
  bounded and skipped with a warning.

## Reaper

The supervisor's storage sweep:

1. list `/repos/runtimes/*`;
2. keep roots for active runtimes/leases/processes;
3. remove runtime roots older than `HARNESS_WORKSPACE_RETENTION_HOURS` (default
   24h) with no active owner;
4. legacy pass: `/repos/<8hex>-*` via a supervisor `WorkspaceManager` rooted at
   `/repos` using the Java `pruneStaleWorkspaces()`; the child/startup manager
   only sees its runtime root, so it does not cover the legacy dirs.
   `java.io.tmpdir` (`opencode-harness-*`/`vibecode-askpass-*`) via
   `pruneStaleTempDirectories()` in the child/startup path.
   `host-storage.sh --legacy` reimplements the same find/prefix/retention rules
   in bash over `/repos` and `${AGENT_TMPDIR:-${TMPDIR:-/tmp}}`; it does not call
   Java. The child/startup temp/own-root prune stays until D10;
5. move suspicious dirs to `orphans/` for `AGENT_ORPHAN_TTL_HOURS` (default
   24h), then delete;
6. prune dangling images weekly (`docker image prune -f` only, never `-a`);
7. report freed bytes and failures as events.

`host-storage.sh` exposes the same sweep as `--dry-run`/`--apply` for manual
recovery; `--legacy` reimplements the same rules in bash over
`/repos/<8hex>-*` and `${AGENT_TMPDIR:-${TMPDIR:-/tmp}}`
(`opencode-harness-*`/`vibecode-askpass-*`). It has no backend control token and
cannot read backend leases; it uses `.active` markers and supervisor PID/state,
and `--apply` is restricted to a documented stopped-supervisor recovery mode (it
refuses live supervisor/marker state, exit 4). The supervisor remains the
lease-safe cleanup owner during normal operation.

## Logs and images

- The supervisor Compose service already uses `json-file` 10m/3; keep it.
- Sandbox/proxy containers are created by `DockerSandboxRunner` with bounded
  1m/1 log options; they are not Compose services. Configurable sandbox
  rotation is deferred as D9.
- Keep the current `vibecode-agent`/sandbox tags; prune dangling images only.
- Keep at most N old tags for rollback when the deployment supports it.

## Caches

- Per-runtime caches under `<runtimeRoot>/cache`; `WorkspaceManager.getCacheDir()`
  creates it, `cleanupRuntime()` deletes it, and the TTL is
  `HARNESS_WORKSPACE_RETENTION_HOURS`.
- Never share a writable cache between runtimes; a read-only shared cache is
  D5.
- Clear `~/.npm`, `~/.m2`, OpenCode temp and `/tmp` on refresh.
- Do not persist `node_modules` across tickets unless the repo profile opts in
  (fg-39).

## Metrics and events

Emit through the fg-41 event sink (or structured logs when the sink is off):

- `storage.workspace` `{runtimeId, ticketId, bytes, inodes}`
- `storage.cleanup` `{runtimeId, ticketId, bytes, reason}`
- `storage.cleanup_failed` `{runtimeId, ticketId, error}`
- `storage.refresh` `{runtimeId, reason, freedBytes}`
- `storage.refresh_failed` `{runtimeId, error}`
- `storage.watermark` `{level, freeBytes, usedPct, freeInodes, inodePct}`
- `storage.log_bytes` `{component, bytes}`
- `storage.budget_exceeded` `{runtimeId, ticketId, budgetGb, usedGb}`
- `storage.orphan` `{path, bytes, action}`
- `storage.image_prune` `{removed, reclaimedBytes}`

## Manual recovery

1. Stop the supervisor (stopped-supervisor recovery mode). There is no
   pool-control token.
2. Confirm no supervisor PID/slot or `.active` marker remains.
3. Run `agent/scripts/host-storage.sh --dry-run`, then `--apply`; add
   `--legacy` for `/repos/<8hex>-*` and `${AGENT_TMPDIR:-${TMPDIR:-/tmp}}`
   temp dirs. The script refuses live supervisor/marker state (exit 4).
4. `docker system df`; prune only dangling images/stopped containers.
5. Verify free bytes/inodes.
6. Restart the supervisor and monitor.

## Failure modes

| Case | Behavior |
|---|---|
| Sandbox destroy fails | Keep the workspace, mark the runtime tracked, fail closed |
| Disk 80% during a run | Finish the current run; reject new claims |
| Disk 95% | Stop assigning; require manual recovery |
| `du` scan slow/timeout | Skip the cycle, log a warning; do not kill the run |
| Refresh restart fails | Child was stopped; mark degraded, emit `storage.refresh_failed`, retry with backoff; keep the workspace if removal failed |
| Orphan dir has a live marker/slot | Skip; log |
| Inode exhaustion | Same as disk pressure; no new claims |
| Cleanup after an unclean exit | Preserve until the fg-33 reaper, then sweep |
| Legacy/temp dirs | Keep the child/startup temp/own-root prune; the supervisor/host `/repos` `--legacy` pass covers the old dirs; D10 retires the legacy path |

## Security considerations

- Workspace deletion is bounded by the runtime root. fg-44 changes
  `assertSafeToDelete` from `toAbsolutePath().normalize()` to
  `toRealPath(LinkOption.NOFOLLOW_LINKS)` (with a non-following fallback for a
  path that does not exist yet); symlinks outside the root are refused.
- No secret is written to a workspace or log; the provider key stays in the
  harness memory/env file.
- `host-storage.sh` runs on the host and never receives `POOL_ADMIN_TOKEN`
  (removed), a backend lease token or provider keys. It uses `.active`
  markers/PID state and `--apply` is stopped-supervisor recovery only.
- Quarantined workspaces may contain repo code; restrict permissions and delete
  after TTL.
- Docker log rotation is mandatory; log contents follow fg-42 redaction.

## Alternatives considered

1. **Keep random clone dirs and a backend reaper** — rejected: the backend
   cannot safely delete host paths, and random names make ownership ambiguous.
2. **Container idle refresh** — rejected: runtimes are child JVMs, not
   containers; restarting the child is the correct unit.
3. **A shared writable cache** — rejected: cross-runtime leakage and
   corruption; D5 keeps a read-only cache as a future option.
4. **Host cron only** — rejected: the supervisor already owns the lifecycle and
   can clean at the right boundary; the host script is for recovery.

## Rollout

1. Add the runtime-scoped layout and ticket cleanup.
2. Add metrics/events and warn-only watermarks.
3. Enable the reaper in dry-run.
4. Enable idle refresh at 2h.
5. Enable stop-spawn/emergency recycle.
6. Tune budgets per role.
7. Run the one-time `/repos` + temp sweep; keep the child/startup temp/own-root
   prune until D10; the `/repos` legacy pass is the supervisor/host script.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
