# 03 — Implementation (fg-44)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Test-First Requirement

Create these stubs **before** production code:

1. `agent/src/test/java/.../service/WorkspaceManagerStorageTest.java` — layout,
   keyed cleanup, runtime cleanup, traversal refusal, byte/inode measurement.
2. `agent/src/test/java/.../supervisor/SupervisorStorageTest.java` — idle
   refresh, max lifetime, watermarks, active safety, orphan sweep.
3. `agent/src/test/java/.../harness/HarnessTicketProcessorStorageTest.java` —
   cleanup after terminal + lease, sandbox-before-delete, budget breach.
4. `agent/scripts/host-storage.test.sh` — dry-run/apply, watermark actions,
   orphan TTL, full-disk recovery.

## Plan

1. **Workspace layout** — `WorkspaceManager` gains a `workspaceKey` and
   `cleanup(workspaceKey)`, `cleanupRuntime()`, `workspaceBytes()`; the
   supervisor passes `REPO_CLONE_DIR=/repos/runtimes/<runtimeId>`.
2. **Ticket cleanup** — `HarnessTicketProcessor` destroys the sandbox, finishes
   the run/lease, then cleans the ticket workspace; failure preserves it and
   emits an event.
3. **Supervisor storage policy** — idle 2h / max 24h refresh, disk/inode
   watermarks, budget meter, orphan sweep, dangling-image prune, log rotation.
4. **Host script** — `agent/scripts/host-storage.sh --dry-run|--apply`.
5. **Compose** — log rotation for supervisor and sandbox.
6. **Docs** — `agent/README.md` storage section, env table, recovery.
7. **Verification** — run the matrix and record results.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/src/main/java/.../service/WorkspaceManager.java` | change | Runtime/ticket keyed root, `cleanup(key)`, `cleanupRuntime()`, `workspaceBytes()`, traversal guards |
| `agent/src/main/java/.../supervisor/Supervisor.java` | change | Pass `REPO_CLONE_DIR` per runtime; idle/max-lifetime refresh; active-slot guard |
| `agent/src/main/java/.../supervisor/SupervisorMain.java` | change | Storage sweep wiring, env parse, watermark log |
| `agent/src/main/java/.../supervisor/StoragePolicy.java` | add | Watermarks, budget, orphan/refresh decisions |
| `agent/src/main/java/.../harness/HarnessTicketProcessor.java` | change | Destroy sandbox → finish → cleanup; budget event |
| `agent/src/main/java/.../harness/HarnessEvent.java` | change | Add `storage.*` event types |
| `agent/scripts/host-storage.sh` | add | Dry-run/apply recovery and sweep |
| `agent/scripts/host-storage.test.sh` | add | Bash fixtures/assertions |
| `agent/docker-compose.yml` | change | Log rotation for supervisor |
| `agent/docker-compose.sandbox.yml` | change | Log rotation for sandbox |
| `agent/README.md` | change | Layout, env vars, refresh, budget, recovery |
| `agent/src/test/java/.../service/WorkspaceManagerStorageTest.java` | add | Keyed layout/cleanup/size |
| `agent/src/test/java/.../supervisor/SupervisorStorageTest.java` | add | Refresh/watermark/orphan/active safety |
| `agent/src/test/java/.../harness/HarnessTicketProcessorStorageTest.java` | add | Cleanup order/budget |
| `agent/scripts/host-storage.test.sh` | add | Recovery script |

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Agent | `WorkspaceManagerStorageTest.java` | runtime 12 / ticket 34 path; traversal refused | `cd agent && mvn test` |
| FR2 | Agent | `HarnessTicketProcessorStorageTest.java` | terminal + lease → cleanup; unclean exit preserved | `mvn test` |
| FR3 | Agent | `SupervisorStorageTest.java` | idle 2h stops/restarts child, keeps id | `mvn test` |
| FR4 | Agent | `SupervisorStorageTest.java` | 24h between tickets only | `mvn test` |
| FR5 | Agent | `SupervisorStorageTest.java` | 70/80/85/90/95 actions; inode same | `mvn test` |
| FR6 | Agent | `HarnessTicketProcessorStorageTest.java` | budget breach → `storage_budget_exceeded`, quarantine | `mvn test` |
| FR7 | Compose | `docker compose config` | log rotation on supervisor/sandbox | `docker compose -f agent/docker-compose.yml config` |
| FR8 | Agent | `SupervisorStorageTest.java` | dangling prune keeps active tag | `mvn test` |
| FR9 | Agent | `SupervisorStorageTest.java` | orphan TTL; active/lease kept | `mvn test` |
| FR10 | Agent | `SupervisorStorageTest.java` | active lease/process skipped | `mvn test` |
| FR11 | Agent | `HarnessEvent` assertions | `storage.*` fields and counts | `mvn test` |
| FR12 | Script | `host-storage.test.sh` | dry-run/apply, full-disk recovery | `bash agent/scripts/host-storage.test.sh` |
| FR13 | Agent | `HarnessTicketProcessorStorageTest.java` | destroy before delete; failed destroy keeps dir | `mvn test` |

## Review checklist

- [ ] Every `FR*` acceptance statement has a passing row
- [ ] No cleanup can escape the runtime root (`toRealPath` + symlink refusal)
- [ ] No active lease/process is ever deleted or stopped
- [ ] Sandbox destroy precedes workspace deletion
- [ ] No `PoolManager`/`POOL_ADMIN_TOKEN` reference remains
- [ ] `04` matches what was built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run (planned) |
