# 02_ARCHITECT_DESIGN.md - Agent Storage Lifecycle and Idle Refresh (fg-44)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-43, fg-33

## Design summary

Make storage a first-class lifecycle: per-agent workspace roots, ticket-scoped cleanup, idle refresh, disk watermarks and a reaper. `PoolManager` remains the owner of container lifecycle; `WorkspaceManager` remains the owner of ticket workspaces.

```
PoolManager
  -> creates /repos/agents/<agentId>
  -> WorkspaceManager clones /repos/agents/<agentId>/<ticketId>
  -> ticket end: WorkspaceManager.cleanup(ticket)
  -> idle 2h: PoolManager.refresh(agentId)
       -> stop container
       -> remove workspace + caches
       -> start fresh container (same identity/key or rotate)
  -> reaper: orphan dirs, old logs, dangling images
```

## Workspace layout

```
/repos/
  agents/
    <agentId>/
      <ticketId>/
        repo/
        tmp/
        logs/
      cache/          # optional per-agent npm/m2 cache, TTL-bound
  orphans/            # quarantine for debugging, short TTL
```

- `REPO_CLONE_DIR=/repos/agents/<agentId>` passed to the agent.
- `WorkspaceManager` must use that root and never delete outside it.
- On ticket end, remove `<ticketId>` entirely.
- On container stop, remove the agent root unless the agent is being refreshed for debugging.

## Idle refresh

Current `PoolManager` has an idle timeout of 5 minutes for pool scaling. Add a separate refresh timer:

- `AGENT_IDLE_REFRESH_MS` default `2h`.
- A refresh is eligible only if:
  - `entry.ticketId == null`;
  - no active lease in the DB/Redis;
  - no child process/OpenCode session;
  - container is healthy/idle.
- Refresh flow:
  1. mark `refreshing` (do not assign tickets);
  2. capture workspace size;
  3. `docker stop` with grace period;
  4. remove the workspace and per-agent cache;
  5. start a new container with the same DB agent id/API key, or rotate the key and delete the old record;
  6. health check + re-register in the pool;
  7. log freed bytes and duration.
- If refresh fails, keep the old container (if still running) or mark the slot degraded and retry later.

A max-lifetime refresh (`AGENT_MAX_LIFETIME_HOURS`, default 24h) uses the same flow but only between tickets.

## Disk watermarks

Compute from the repo volume filesystem:

| Usage | Action |
|---|---|
| 70% | warn, emit metric |
| 80% | stop spawning new agents; reject `requestAgent` with a clear error |
| 85% | clean idle agent workspaces/caches; re-run `df` |
| 90% | emergency recycle oldest idle agents; alert; consider pausing the pool |
| 95% | stop assigning tickets; require manual recovery |

Inode usage uses the same thresholds. A full disk must not be treated as a ticket failure.

## Reaper

A periodic job (in `PoolManager` or host cron):

1. list `/repos/agents/*`;
2. keep directories for active pool entries/leases;
3. remove directories older than `AGENT_WORKSPACE_TTL_HOURS` (default 24h) with no active owner;
4. move suspicious dirs to `orphans/` for a short TTL, then delete;
5. prune dangling images weekly (`docker image prune -f` only, never `-a` blindly);
6. rotate/truncate Docker logs (prefer log driver config over truncation);
7. report freed bytes and failures.

## Logs and images

Docker log config per container:

```json
{
  "Type": "json-file",
  "Config": { "max-size": "10m", "max-file": "3" }
}
```

- Never use unbounded default json-file logging.
- Prune dangling images only; keep the current `vibecode-agent` tag.
- Keep at most N old images for rollback if the deployment supports it.

## Caches

- Prefer per-agent caches with a TTL; never share a writable cache between agents.
- A read-only shared dependency cache is a later optimization.
- Do not persist `node_modules` across tickets unless the repo/profile explicitly opts in.
- Clear `~/.npm`, `~/.m2`, OpenCode temp and `/tmp` on refresh.

## Active-ticket safety

- The refresh/reaper checks the DB lease and the in-memory pool entry.
- If either says active, skip and log.
- A stale lease (fg-33) must be reaped before the workspace can be removed.
- Never delete a workspace on a `SIGKILL` while a ticket is active; wait for the reaper after the lease expires.

## Metrics

- `agent_workspace_bytes{agent}`
- `agent_cache_bytes{agent}`
- `host_disk_free_bytes`, `host_disk_used_percent`
- `host_inodes_free`, `host_inodes_used_percent`
- `agent_refresh_total{reason}`
- `agent_cleanup_total{reason}`
- `agent_orphan_dirs`
- `docker_image_bytes`, `docker_log_bytes`

## Manual recovery

Document:

1. stop new assignments (`MAX_POOL_SIZE=0` or pause flag);
2. `docker ps` and stop idle agents;
3. run the reaper/cleanup script in dry-run, then apply;
4. `docker system df` and prune only safe objects;
5. verify free space/inodes;
6. restart the pool and monitor.

## Tests

- ticket cleanup on success/failure;
- idle 2h refresh, including identity/key handling;
- active ticket is never refreshed/cleaned;
- 80%/85%/90% watermark behavior;
- inode pressure;
- orphan reaper and TTL;
- log rotation config;
- image prune safety;
- full-disk recovery script.

## Rollout

1. Add per-agent workspace roots and ticket cleanup.
2. Add metrics and warn-only watermarks.
3. Enable reaper in dry-run.
4. Enable idle refresh at 2h.
5. Enable stop-spawn/emergency recycle.
6. Tune budgets per profile.

## Open questions

1. Per-agent volume vs shared volume with subdirectories?
2. Keep the same DB agent identity across refresh or rotate the key?
3. Is 2h idle refresh too aggressive for long test runs? (Only idle, never active.)
4. Can we use Docker storage quotas for workspace size, or only cleanup?
5. Do we need a read-only shared cache for node_modules/Maven?
6. Where should the reaper run: backend, host cron, or a sidecar?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-43 | Host sizing and limits | Infrastructure | `fg-43-agent-docker-deployment` | No |
| 2 | fg-33 | Durable lease before cleanup | Reliability | `fg-33-durable-harness-execution` | No |
| 3 | fg-34 | Sandboxed workspaces | Security | `fg-34-harness-sandbox` | No |
| 4 | fg-40 | Per-agent worktrees | Agent | `fg-40-multi-agent-orchestration` | No |
