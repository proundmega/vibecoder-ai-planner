# 03 — Implementation (fg-59)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Plan

- [x] Add the host/docker image-prune default and tests
- [x] Measure the runtime cache in the budget and clean it when safe
- [x] Write/clear the runtime-level pickup marker and test it
- [x] Update README/Compose and run the matrix

## Per-file changes

| File | Action | Change |
|---|---|---|
| `Supervisor.java` | change | prune default helper |
| `WorkspaceManager.java` | change | `runtimeBytes()`, `cleanupCache()` |
| `HarnessTicketProcessor.java` | change | runtime marker, cache budget/cleanup |
| `agent/README.md` | change | host-mode prune and cache notes |
| `agent/docker-compose*.yml` | change | empty prune override |
| tests | change | supervisor, workspace, processor |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java | `SupervisorStorageTest` | `imagePruneDefaultsToDockerModeOnly` | `mvn test` |
| FR2 | Java | `WorkspaceManagerStorageTest`, `HarnessTicketProcessorStorageTest` | `runtimeBytesIncludeTheSharedCache`, `cleanupCacheRemovesOnlyTheRuntimeCache`, `periodicMeter...`, `budgetBreachQuarantines...` | same |
| FR3 | Java | `HarnessTicketProcessorStorageTest`, `SupervisorStorageTest` | `runtimeActiveMarkerCovers...`, `legacyRepoRootDoesNotGetARuntimeMarker`, `recycleOldestKeepsAFreshActiveRuntime` | same |
| FR4 | Docs | README/Compose | host-mode default and cache wording | diff |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-23 | `feat/fg-59-storage-hardening` | Agent 986 (local); host-storage 20/20; host-init 78/78; Compose base+sandbox; planning 17 suites | Host-mode prune default, runtime-cache/inode budget and safe cache cleanup, pickup-time runtime marker (skipped at concurrency > 1; D4), legacy budget fallback. |
