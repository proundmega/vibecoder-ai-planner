# 03 — Implementation (fg-58)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

- [x] Add `StorageSweeper`/`StorageUsage` and inode sampling
- [x] Wire idle/max-lifetime refresh into `Supervisor`
- [x] Apply 85/90/95 actions (clean idle, recycle oldest, stop assignment)
- [x] Add runtime-root/legacy/temp sweep + `orphans/` quarantine
- [ ] Add periodic budget meter and quarantine on breach (remaining)
- [x] Emit the core `storage.workspace/refresh/refresh_failed/watermark/orphan` events
- [x] Make `host-storage.sh` stale-safe and guard `cleanupRuntime()`
- [ ] Update docs and run the matrix

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
| FR1 | Java | `SupervisorStorageTest` | idle refresh restarts and removes root; active kept | `mvn test` |
| FR2 | Java | `SupervisorStorageTest` | max lifetime only between tickets | same |
| FR3 | Java | `SupervisorStorageTest` | 70/80/85/90/95 actions and inode sampling | same |
| FR4 | Java + Shell | `SupervisorStorageTest`, `host-storage.test.sh` | runtime/legacy/temp sweep and orphan TTL | both |
| FR5 | Java | `HarnessEventStorageTest` | every storage event type/payload | `mvn test` |
| FR6 | Java | `HarnessTicketProcessorStorageTest` | periodic breach quarantines | `mvn test` |
| FR7 | Shell | `host-storage.test.sh` | stale PID/.active allows apply | bash |
| FR8 | Java | `WorkspaceManagerStorageTest` | base root refused | `mvn test` |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-58-supervisor-storage-lifecycle` | Agent 963; host-storage 14/14; host-init 78/78; Compose base | Supervisor idle/max refresh, disk+inode sampling, 85/90/95 actions, runtime/legacy/temp sweep/quarantine, core storage events. Periodic budget/quarantine remains. |
