# 03 — Implementation (fg-58)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

- [x] Add `StorageSweeper`/`StorageUsage` and inode sampling
- [x] Wire idle/max-lifetime refresh into `Supervisor`
- [x] Apply 85/90/95 actions (clean idle, recycle oldest, stop assignment)
- [x] Add runtime-root/legacy/temp sweep + `orphans/` quarantine (stale markers expire)
- [x] Add periodic budget meter and quarantine on breach
- [x] Emit every `storage.*` event and run the sweep every tick, not only at 85/90
- [x] Make `host-storage.sh` stale-safe, sweep `/repos/orphans`, and guard `cleanupRuntime()`
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
| FR1 | Java | `SupervisorStorageTest` | `idleRuntimeIsStoppedAndItsRootRemoved`; `refreshDue` ignores active | `mvn test` |
| FR2 | Java | `SupervisorStorageTest` | `refreshDue` lifetime/idle cases; active runtime untouched | same |
| FR3 | Java | `SupervisorStorageTest` | `samplesDiskAndInodePercentages`; `cleanIdleStopsTheIdleChild`; `recycleOldestStopsTheIdleChildAndReconcileRespawns`; `manualRecoveryBlocksNewSpawns` | same |
| FR4 | Java + Shell | `StorageSweeperTest`, `SupervisorStorageTest`, `host-storage.test.sh` | `staleMarkerDoesNotPinARuntimeRoot`; `sweepRunsPeriodicallyWithoutWatermarkPressure`; runtime/legacy/temp/orphan tests | both |
| FR5 | Java | `HarnessEventStorageTest`, `HarnessTicketProcessorStorageTest`, `SupervisorStorageTest` | `recognisesEveryStorageEventType`; `periodicMeterEmitsBudgetEventAndMarksTheRun`; assertions on workspace (`runtimeId/runtimeName/path`), refresh (`reason/runtime`) and orphan (`removed/action`) payloads | `mvn test` |
| FR6 | Java | `HarnessTicketProcessorStorageTest`, `WorkspaceManagerStorageTest` | periodic meter event+flag; `budgetBreachQuarantinesThroughTheProcessor` (moves instead of deleting); quarantine path test | `mvn test` |
| FR7 | Shell | `host-storage.test.sh` | live PID/marker exit 4; stale PID; stale/aged marker is reaped; old orphan reaped | bash |
| FR8 | Java | `WorkspaceManagerStorageTest` | `refusalToDeleteTheRepositoryBaseRoot` | `mvn test` |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `76b9839` (branch `feat/fg-58-supervisor-storage-lifecycle`) | Agent 982 (981 at `afc1a20` + the processor quarantine test; 978 locally without image-gated tests); host-storage 20/20; host-init 78/78; Compose base+sandbox | Periodic sweep, stale-marker TTL, real 85/90/95 actions, `/repos/orphans` quarantine, lifecycle env forwarding, async/timeout-bounded image prune, periodic budget+inode meter, processor quarantine on breach and payload assertions for workspace/refresh/orphan events. |
| 2026-11-23 | `04081bf` (PR #212) | Agent 978 run / 10 skipped on `master` (Docker-gated tests skipped locally); host-storage 20/20; host-init 78/78 | Merged to `master`. Suite moved to `planning/DONE/`; no implementation changes in this closeout. |
