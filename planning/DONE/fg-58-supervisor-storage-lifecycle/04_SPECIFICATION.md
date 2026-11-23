# 04 — Specification (fg-58)

> **Owns:** exact file operations and contracts.
> **Not here:** design (`02`), requirements (`01`), verification matrix (`03`),
> status (`00`).

## Test stubs first

Add/extend `SupervisorStorageTest`, `HarnessEventStorageTest`,
`HarnessTicketProcessorStorageTest`, `WorkspaceManagerStorageTest` and
`host-storage.test.sh` before production changes.

## Contracts

- `StorageSweeper.sample(Path root)` → disk/inode percentages from `df -Pk` and
  `df -Pi`.
- `StorageSweeper.sweepRuntimeRoots(root, orphans, ttl, markerTtl, activeIds)` →
  removed count; only a `.active` marker newer than `markerTtl` is live; old
  roots are quarantined. Stale markers never pin a root.
- `StorageSweeper.sweepLegacy(root, tmp, ttl)` → `<8hex>-*` and temp prefixes.
- `StorageSweeper.quarantine(root, orphans)` → move to
  `orphans/<runtime>-<ticket>-<timestamp>`.
- `WorkspaceManager.cleanupRuntime()` refuses `/repos` or a final path segment
  `repos`.
- `host-storage.sh` parses the PID JSON and checks `kill -0`; `.active` is live
  only within `HARNESS_WORKSPACE_RETENTION_HOURS`; `--orphans` reaps
  `/repos/orphans` after `AGENT_ORPHAN_TTL_HOURS`.
- The supervisor runs `sweepStorage()` every tick regardless of watermark level;
  85/90 stop idle children and 95 blocks new spawns.
- Dangling-image prune runs off the reconcile lock with a timeout
  (`AGENT_IMAGE_PRUNE_TIMEOUT_SECONDS`) and is disabled with
  `AGENT_IMAGE_PRUNE_ENABLED=false`.

## Verification commands

```bash
cd agent && mvn test -Dtest=WorkspaceManagerStorageTest,SupervisorStorageTest,HarnessTicketProcessorStorageTest,HarnessEventStorageTest
bash agent/scripts/host-storage.test.sh
node planning/check-planning.js
git diff --check
```
