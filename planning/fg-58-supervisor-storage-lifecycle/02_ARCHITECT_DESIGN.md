# 02 — Design (fg-58)

> **Owns:** current-state audit, design, data flow, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file
> operations (`04`), status (`00`).

## Current state

PR #209 added `WorkspaceManager` keyed layout/cleanup/measurement,
`StoragePolicy` and the `host-storage.sh` recovery script. `Supervisor` only
passes the runtime root and logs a synthetic watermark; it never refreshes,
recycles, quarantines or sweeps. `HarnessTicketProcessor` checks the budget once.

## Design

A `StorageSweeper`/`StorageUsage` helper owns filesystem sampling and reaping:

- `sample(Path root)` parses `df -Pk` and `df -Pi` for disk/inode percentages.
- `sweepRuntimes(base, orphanDir, ttl, activeIds)` skips directories with a
  fresh `.active` or active supervisor slot; old roots are moved to
  `orphans/<runtime>-<timestamp>` and deleted after `AGENT_ORPHAN_TTL_HOURS`.
- legacy `/repos/<8hex>-*` and temp prefixes use the same TTL/prefix rules.
- `quarantine(ticketRoot, orphanDir)` is used on a budget breach.

`Supervisor` runs the tick in `runLoop`:

1. Sample disk/inodes and update `StoragePolicy.Usage`.
2. Evaluate; 70/80/85/90/95 produce their actions and structured events.
3. For each tracked child with no `.active` marker and no active slot, compare
   root mtime and child start; at idle/lifetime, stop it and remove its root;
   the next reconcile spawns a fresh child with the same runtime id.
4. Sweep old roots/legacy/temp every `HARNESS_WORKSPACE_RETENTION_HOURS`.
5. Prune dangling images weekly (only `docker image prune -f`).

Events use the existing fg-41 sink when available, otherwise structured
`storage.*` logs. Payloads are redacted and never contain file contents.

## Remaining host-script changes

- Parse the supervisor PID record and `kill -0` the PID; a dead PID is stale.
- Treat `.active` as live only when its mtime is within
  `HARNESS_WORKSPACE_RETENTION_HOURS`; stale markers are removed with `--apply`
  and never pin an aged root.
- `--orphans` reaps `/repos/orphans` after `AGENT_ORPHAN_TTL_HOURS`.
- `cleanupRuntime()` refuses a base root named `repos`.
