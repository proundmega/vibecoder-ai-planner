# 02 — Design (fg-44)

> **Owns:** current-state audit, design, data flow, contracts, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file operations
> (`04`), status and deferrals (`00`).

## Current State

- `WorkspaceManager(repoCloneDir, repoName, ...)` clones into a random
  `<8hex>-<repo>` directory under `REPO_CLONE_DIR`; it has a no-arg `cleanup()`
  and no ticket/runtime key.
- The fg-54 supervisor spawns one child per runtime and passes
  `REPO_CLONE_DIR` (default `/repos`); children share the same root.
- `HarnessTicketProcessor` owns the clone, the sandbox and the finish path, so
  it is the natural cleanup caller.
- There is no idle-refresh timer, disk/inode watermark, budget meter, orphan
  reaper or `host-storage.sh`.
- Docker log rotation is not configured for the supervisor/sandbox.

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
       -> du/inode meter, watermarks, orphan reaper, dangling images
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
- `assertSafeToDelete` continues to refuse anything outside the normalized
  runtime root.

## Cleanup flow

1. The run reaches `succeeded`, `failed`, `budget_exceeded` or `dead_letter`.
2. `HarnessTicketProcessor` destroys the sandbox (if any) and verifies the
   destroy/close result.
3. It records the final checkpoint/finish (lease release).
4. Only after the lease release, it calls `WorkspaceManager.cleanup(ticketId)`.
5. On failure, it preserves the workspace and emits a `storage.cleanup_failed`
   event; the orphan sweep retries after TTL.
6. On an unclean JVM exit, the workspace stays until the fg-33 reaper marks the
   run terminal and the lease expires; the storage sweep then removes it.

Cleanup is idempotent and never touches a directory with an active workspace
lock (a `.active` marker or the supervisor's in-memory slot).

## Idle refresh and max lifetime

- The supervisor tracks `lastActivityAt` per runtime (last claim/finish).
- `AGENT_IDLE_REFRESH_MS` default `7200000` (2h); `AGENT_MAX_LIFETIME_HOURS`
  default `24`.
- Eligible only if no ticket, no lease, no child process and no sandbox.
- Flow: mark `refreshing` (not assignable), capture size, stop the child with
  `SUPERVISOR_STOP_TIMEOUT_SECONDS`, destroy the sandbox, remove the runtime
  root and caches, start a fresh child with the same runtime id, refresh the
  node credential, health check and re-register.
- If the restart fails, keep the old child when possible; otherwise mark the
  slot degraded and retry.
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
| 95% | stop assigning; require `host-storage.sh --apply` |

Inode usage uses the same thresholds. The backend exposes the current state via
the existing heartbeat/status payload so the fleet UI can show it.

## Budget meter

- Every `AGENT_STORAGE_METER_SECONDS` (default 300), walk the active runtime
  roots with `du -sb` and count inodes (bounded depth; skip `.git` objects if
  needed).
- Compare against the fg-43 role budget (worker 20 GB, reviewer/planner 10 GB,
  light 5 GB).
- On breach: send `SIGTERM` to the workspace child/sandbox, fail the run with
  `storage_budget_exceeded`, move the ticket dir to `orphans/`, emit an event
  and alert.
- The meter is best-effort and never blocks the supervisor loop; a slow scan is
  bounded and skipped with a warning.

## Reaper

The supervisor's storage sweep:

1. list `/repos/runtimes/*`;
2. keep roots for active runtimes/leases/processes;
3. remove roots older than `AGENT_WORKSPACE_TTL_HOURS` (default 24h) with no
   active owner;
4. move suspicious dirs to `orphans/` for `AGENT_ORPHAN_TTL_HOURS` (default
   24h), then delete;
5. prune dangling images weekly (`docker image prune -f` only, never `-a`);
6. report freed bytes and failures as events.

`host-storage.sh` exposes the same sweep as `--dry-run`/`--apply` for manual
recovery, without a control token.

## Logs and images

- Compose and sandbox `LogConfig`: `json-file`, `max-size=10m`,
  `max-file=3`.
- Keep the current `vibecode-agent`/sandbox tags; prune dangling images only.
- Keep at most N old tags for rollback when the deployment supports it.

## Caches

- Per-runtime caches under `<runtimeRoot>/cache` with a TTL.
- Never share a writable cache between runtimes; a read-only shared cache is
  D5.
- Clear `~/.npm`, `~/.m2`, OpenCode temp and `/tmp` on refresh.
- Do not persist `node_modules` across tickets unless the repo profile opts in
  (fg-39).

## Metrics and events

Emit through the fg-41 event sink (or structured logs when the sink is off):

- `storage.workspace_bytes{runtime,ticket}`
- `storage.cache_bytes{runtime}`
- `storage.disk_free_bytes`, `storage.disk_used_percent`
- `storage.inodes_free`, `storage.inodes_used_percent`
- `storage.refresh` (reason: idle/max_lifetime/failed)
- `storage.cleanup` (reason: success/failure/terminal)
- `storage.orphan_dirs`
- `storage.budget_exceeded`
- `storage.watermark` (level)

## Manual recovery

1. Stop new claims: stop the supervisor or remove the runtime sections and
   HUP. There is no pool-control token.
2. `docker ps` and stop idle supervisors/sandboxes.
3. Run `agent/scripts/host-storage.sh --dry-run`, then `--apply`.
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
| Refresh restart fails | Keep the old child if alive; else degraded slot + retry |
| Orphan dir has an active lease | Skip; log |
| Inode exhaustion | Same as disk pressure; no new claims |
| Cleanup after an unclean exit | Preserve until the fg-33 reaper, then sweep |

## Security considerations

- Workspace deletion is bounded by `toRealPath()` and the runtime root; never
  follow symlinks outside it.
- No secret is written to a workspace or log; the provider key stays in the
  harness memory/env file.
- `host-storage.sh` runs on the host and never receives `POOL_ADMIN_TOKEN`
  (removed) or provider keys.
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

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
