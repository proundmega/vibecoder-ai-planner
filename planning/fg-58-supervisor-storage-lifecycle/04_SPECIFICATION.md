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
- `StorageSweeper.sweepRuntimeRoots(root, orphans, ttl, activeIds)` → removed
  count; fresh `.active`/active slot skipped; old roots quarantined.
- `StorageSweeper.sweepLegacy(root, tmp, ttl)` → `<8hex>-*` and temp prefixes.
- `StorageSweeper.quarantine(root, orphans)` → move to
  `orphans/<runtime>-<ticket>-<timestamp>`.
- `WorkspaceManager.cleanupRuntime()` refuses `/repos` or a final path segment
  `repos`.
- `host-storage.sh` parses the PID JSON and checks `kill -0`; `.active` is live
  only within `HARNESS_WORKSPACE_RETENTION_HOURS`.

## Verification commands

```bash
cd agent && mvn test -Dtest=WorkspaceManagerStorageTest,SupervisorStorageTest,HarnessTicketProcessorStorageTest,HarnessEventStorageTest
bash agent/scripts/host-storage.test.sh
node planning/check-planning.js
git diff --check
```
