# 03 — Implementation (fg-44)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Test-First Requirement

Create these stubs **before** production code:

1. `agent/src/test/java/.../service/WorkspaceManagerStorageTest.java` — layout,
   cache, keyed/runtime cleanup, traversal refusal, byte/inode measurement and
   legacy-prefix handling.
2. `agent/src/test/java/.../supervisor/SupervisorStorageTest.java` — idle
   refresh, max lifetime, watermarks, runtime-root + legacy sweep, active safety.
3. `agent/src/test/java/.../harness/HarnessTicketProcessorStorageTest.java` —
   cleanup after terminal + lease, sandbox-before-delete, `.active` preserved
   on failure, budget breach.
4. `agent/scripts/host-storage.test.sh` — dry-run/apply, stopped-supervisor and
   `.active`/PID guards, `--legacy` over `/repos` and `AGENT_TMPDIR`, watermark
   actions, orphan TTL, full-disk recovery.
5. `agent/src/test/java/.../harness/HarnessEventStorageTest.java` — workspace
   bytes/inodes, free bytes/inodes, log bytes, refresh/cleanup/orphan counts.

## Plan

1. **Workspace layout** — `WorkspaceManager` gains a `workspaceKey` and
   `cleanup(workspaceKey)`, `cleanupRuntime()`, `workspaceBytes()`; the
   supervisor passes `REPO_CLONE_DIR=/repos/runtimes/<runtimeId>`.
2. **Ticket cleanup** — `HarnessTicketProcessor` destroys the sandbox, finishes
   the run/lease, then cleans the ticket workspace; failure preserves it and
   emits an event.
3. **Supervisor storage policy** — idle 2h / max 24h refresh, disk/inode
   watermarks, role budget meter (`AGENT_DISK_BUDGET_GB` override),
   runtime-root + legacy/temp sweep, dangling-image prune. Keep the child/
   startup temp/own-root prune; the supervisor `/repos`-rooted legacy pass
   covers the old random dirs until D10.
4. **Host script** — `agent/scripts/host-storage.sh --dry-run|--apply` in
   stopped-supervisor recovery mode with `.active`/PID guards and `--legacy`.
5. **Compose** — verify the existing supervisor 10m/3 rotation; pass
   `AGENT_DISK_BUDGET_GB` and `HARNESS_WORKSPACE_RETENTION_HOURS`; sandbox/proxy
   logs stay Java-created at 1m/1.
6. **Docs** — `agent/README.md` storage section, env table, recovery.
7. **Verification** — run the matrix and record results.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/src/main/java/.../service/WorkspaceManager.java` | change | Runtime/ticket-keyed root (`<ticketRoot>/repo`), `cleanup(key)`, `cleanupRuntime()`, `getCacheDir()`, `workspaceBytes()`, `.active` guard, `toRealPath(NOFOLLOW_LINKS)` deletion guard; keep `pruneStaleWorkspaces()`/`pruneStaleTempDirectories()` for the supervisor `/repos` legacy pass and child temp; the child manager's clone root is the runtime root |
| `agent/src/main/java/.../supervisor/Supervisor.java` | change | Pass `REPO_CLONE_DIR` per runtime; idle/max-lifetime refresh; active-slot guard |
| `agent/src/main/java/.../supervisor/SupervisorMain.java` | change | Storage sweep wiring, env parse, watermark log |
| `agent/src/main/java/.../supervisor/StoragePolicy.java` | add | Watermarks, role/budget, orphan/refresh decisions; `RuntimeState` |
| `agent/src/main/java/.../harness/HarnessTicketProcessor.java` | change | Destroy sandbox → finish → keyed cleanup; `.active` marker; budget event; keep the existing temp/own-root prune; the `/repos` legacy pass is supervisor/host |
| `agent/src/main/java/.../harness/HarnessEvent.java` | change | Add `storage.*` event types |
| `agent/scripts/host-storage.sh` | add | Dry-run/apply stopped-supervisor recovery; `.active`/PID guards; `--legacy` reimplements find/prefix rules over `/repos` and `${AGENT_TMPDIR:-${TMPDIR:-/tmp}}`; no Java CLI |
| `agent/scripts/host-storage.test.sh` | add | Bash fixtures for dry-run/apply/`--legacy` over `/repos` and `AGENT_TMPDIR`, stopped-supervisor/.active/PID |
| `agent/scripts/host-init.sh` | change | Write `AGENT_DISK_BUDGET_GB` and `HARNESS_WORKSPACE_RETENTION_HOURS` to `.env.agent-host` when set |
| `agent/scripts/host-init.test.sh` | change | Assert both overrides are written |
| `agent/docker-compose.yml` | change | Pass `AGENT_DISK_BUDGET_GB` and `HARNESS_WORKSPACE_RETENTION_HOURS`; verify existing 10m/3 supervisor rotation |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | verify (no change) | Keep the startup prune for its own runtime root/temp; the `/repos` legacy pass is supervisor/host; D10 retires it |
| `agent/src/test/java/.../harness/HarnessTicketProcessorTest.java` | verify (no change) | Keep the existing legacy/temp prune tests |
| `agent/src/test/java/.../service/WorkspaceManagerTest.java` | verify (no change) | Keep the existing legacy/temp prune tests |
| `agent/README.md` | change | Layout, env vars, refresh, budget, recovery |
| `agent/src/test/java/.../service/WorkspaceManagerStorageTest.java` | add | Keyed layout/cache/cleanup/size/traversal/symlink/legacy prefixes |
| `agent/src/test/java/.../supervisor/SupervisorStorageTest.java` | add | Refresh/watermark/runtime-root + legacy sweep/active safety/budget |
| `agent/src/test/java/.../harness/HarnessTicketProcessorStorageTest.java` | add | Cleanup order/budget/.active preserved on failure |
| `agent/src/test/java/.../harness/HarnessEventStorageTest.java` | add | Workspace bytes/inodes, free bytes/inodes, log bytes, refresh/cleanup/orphan counts |

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Agent | `WorkspaceManagerStorageTest.java` | runtime 12 / ticket 34; `repo/`, `tmp/`, `logs/`, `cache/`; traversal and symlink/non-existent targets refused | `cd agent && mvn test` |
| FR2 | Foundation + `fg-58` | `WorkspaceManagerStorageTest.java`, `fg-58` | keyed cleanup/marker done; processor terminal/lease order in `fg-58` | `mvn test`; `mvn test` (fg-58) |
| FR3 | Follow-up `fg-58` | `fg-58` `SupervisorStorageTest` | idle 2h stops/restarts child, no active harness | `mvn test` (fg-58) |
| FR4 | Follow-up `fg-58` | `fg-58` `SupervisorStorageTest` | 24h between tickets only | `mvn test` (fg-58) |
| FR5 | Follow-up `fg-58` | `fg-58` `SupervisorStorageTest` | 70/80/85/90/95 actions and inode sampling | `mvn test` (fg-58) |
| FR6 | Foundation + `fg-58` | `HarnessTicketProcessorStorageTest.java`, `host-init.test.sh`, `fg-58` | role/override budget and env done; periodic meter/quarantine in `fg-58` | `mvn test -Dtest=HarnessTicketProcessorStorageTest && bash agent/scripts/host-init.test.sh` |
| FR7 | Compose + Agent | `DockerSandboxRunnerTest.java` | supervisor 10m/3; existing sandbox/proxy 1m/1 | `docker compose -f agent/docker-compose.yml config && mvn test -Dtest=DockerSandboxRunnerTest` |
| FR8 | Follow-up `fg-58` | `fg-58` `SupervisorStorageTest` | dangling prune keeps active tag | `mvn test` (fg-58) |
| FR9 | Script + `fg-58` | `host-storage.test.sh`, `fg-58` | host script legacy/retention done; supervisor runtime-root sweep in `fg-58` | `bash agent/scripts/host-storage.test.sh`; `mvn test` (fg-58) |
| FR10 | Follow-up `fg-58` | `fg-58` `SupervisorStorageTest` | `.active` marker/supervisor slot skipped | `mvn test` (fg-58) |
| FR11 | Partial + `fg-58` | `HarnessEventStorageTest.java`, `fg-58` | cleanup/budget events done; workspace/refresh/watermark/orphan/image/log events in `fg-58` | `mvn test`; `mvn test` (fg-58) |
| FR12 | Script | `host-storage.test.sh` | stopped-supervisor/`.active`/PID/`--legacy` over `/repos` and `AGENT_TMPDIR`; full-disk recovery | `bash agent/scripts/host-storage.test.sh` |
| FR13 | Foundation + `fg-58` | `WorkspaceManagerStorageTest.java`, `fg-58` | runtime guard done; processor destroy-before-delete in `fg-58` | `mvn test`; `mvn test` (fg-58) |

## Rollout

1. Ship the keyed layout/runtime-root sweep with the child/startup temp/own-root
   prune still in place.
2. Run the one-time `/repos` + temp `host-storage.sh --legacy` (or supervisor
   `/repos`-rooted) pass.
3. Retire the supervisor `/repos` legacy pass after the legacy dirs are gone
   (D10); keep the child/startup temp/own-root prune until it is migrated.

## Review checklist

- [x] Every `FR*` acceptance statement has a passing row (`03` + `DONE/fg-58-supervisor-storage-lifecycle/03`)
- [x] No cleanup can escape the runtime root (`toRealPath` + symlink refusal)
- [x] No live `.active` marker or active supervisor slot is deleted or stopped
- [x] Sandbox destroy precedes workspace deletion
- [x] Legacy/temp cleanup is preserved or migrated with tests (`pruneStaleTempDirectories` not dropped)
- [x] No new `PoolManager`/`POOL_ADMIN_TOKEN` dependency; historical references are explanatory only
- [x] `04` is the implementation contract; `Results` records as-built deviations

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `85944c9` | Agent 960 tests (storage 15); host-storage 14/14; host-init 78/78; Compose base+sandbox | **Foundation split:** runtime/ticket keyed workspaces, keyed cleanup + active marker, budget helper/policy, host-init/Compose env, host-storage recovery and tests. Supervisor idle refresh, inode watermarks, periodic sweep/quarantine, periodic budget and the full event set are follow-up `fg-58`. |
| 2026-11-22 | `04081bf` | fg-58 verification (`DONE/fg-58-supervisor-storage-lifecycle/03`) | **Lifecycle complete:** supervisor idle/max refresh, watermarks, periodic sweep/quarantine, periodic budget and storage events merged in #212. |
