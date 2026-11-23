# 03 — Implementation (fg-58)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

- [x] Add `StorageSweeper`/`StorageUsage` and inode sampling
- [x] Wire idle/max-lifetime refresh into `Supervisor`
- [x] Apply 85/90/95 actions (clean idle, recycle oldest, stop assignment)
- [x] Add runtime-root/legacy/temp sweep + `orphans/` quarantine
- [x] Add periodic budget meter and quarantine on breach
- [x] Emit `storage.workspace/refresh/refresh_failed/watermark/orphan/image_prune/log_bytes` events
- [x] Make `host-storage.sh` stale-safe and guard `cleanupRuntime()`
- [x] Update docs and run the matrix

## Per-file changes

| File | Action | Change |
|---|---|---|
| `StorageSweeper.java` / `StorageUsage.java` | add | Sampling, sweep/quarantine |
| `Supervisor.java` | change | Tick, refresh, watermark actions, events |
| `WorkspaceManager.java` | change | Refuse base-root `cleanupRuntime` |
| `HarnessTicketProcessor.java` | change | Periodic budget/quarantine |
| `agent/scripts/host-storage.sh` | change | PID liveness and marker age |
| `agent/README.md` | change | Lifecycle/events/recovery |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java | `SupervisorStorageTest` | `idleRuntimeIsStoppedAndItsRootRemoved`; refresh due decision ignores active | `mvn test` |
| FR2 | Java | `SupervisorStorageTest` | `refreshDue` lifetime/idle cases; active runtime untouched | same |
| FR3 | Java | `SupervisorStorageTest`, `StorageSweeperTest` | 70/80/85/90/95 actions; `samplesDiskAndInodePercentages`; sweep actions | same |
| FR4 | Java + Shell | `StorageSweeperTest`, `host-storage.test.sh` | runtime/legacy/temp sweep and orphan TTL | both |
| FR5 | Java | `HarnessEventStorageTest`, `HarnessTicketProcessorStorageTest`, `SupervisorStorageTest` | all event types; meter payload; workspace event | `mvn test` |
| FR6 | Java | `HarnessTicketProcessorStorageTest`, `WorkspaceManagerStorageTest` | `periodicMeterEmitsBudgetEventAndMarksTheRun`; quarantine moves root | `mvn test` |
| FR7 | Shell | `host-storage.test.sh` | stale PID/.active allows apply; live state exits 4 | bash |
| FR8 | Java | `WorkspaceManagerStorageTest` | base root refused | `mvn test` |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-58-supervisor-storage-lifecycle` | Agent 970; host-storage 14/14; host-init 78/78; Compose base | Supervisor idle/max refresh, disk+inode sampling, 85/90/95 actions, runtime/legacy/temp sweep/quarantine, periodic budget meter/quarantine, image prune and the full `storage.*` event set. |
