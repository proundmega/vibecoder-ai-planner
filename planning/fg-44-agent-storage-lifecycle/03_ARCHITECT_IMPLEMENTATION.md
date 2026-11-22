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
| FR2 | Agent | `HarnessTicketProcessorStorageTest.java` | terminal + lease → keyed cleanup; `.active` preserved on failure; unclean exit retained | `mvn test` |
| FR3 | Agent | `SupervisorStorageTest.java` | idle 2h stops/restarts child, no active harness; failed restart degraded/retried | `mvn test` |
| FR4 | Agent | `SupervisorStorageTest.java` | 24h between tickets only | `mvn test` |
| FR5 | Agent | `SupervisorStorageTest.java` | 70/80/85/90/95 actions; inode same | `mvn test` |
| FR6 | Agent + Shell | `HarnessTicketProcessorStorageTest.java`, `host-init.test.sh` | role/override budget; retention env; breach → `storage_budget_exceeded`; env written | `mvn test -Dtest=HarnessTicketProcessorStorageTest && bash agent/scripts/host-init.test.sh` |
| FR7 | Compose + Agent | `DockerSandboxRunnerTest.java` | supervisor 10m/3; existing sandbox/proxy 1m/1 | `docker compose -f agent/docker-compose.yml config && mvn test -Dtest=DockerSandboxRunnerTest` |
| FR8 | Agent | `SupervisorStorageTest.java` | dangling prune keeps active tag | `mvn test` |
| FR9 | Agent + Script | `SupervisorStorageTest.java`, `WorkspaceManagerStorageTest.java`, `host-storage.test.sh` | `HARNESS_WORKSPACE_RETENTION_HOURS` TTL; runtime-root + `/repos` legacy + `java.io.tmpdir`/`AGENT_TMPDIR` temp (`--legacy`); active/lease kept | `mvn test && bash agent/scripts/host-storage.test.sh` |
| FR10 | Agent | `SupervisorStorageTest.java` | `.active` marker/supervisor slot skipped | `mvn test` |
| FR11 | Agent | `HarnessEventStorageTest.java` | workspace bytes/inodes, free bytes/inodes, log bytes, refresh/cleanup/orphan counts | `mvn test -Dtest=HarnessEventStorageTest` |
| FR12 | Script | `host-storage.test.sh` | stopped-supervisor/`.active`/PID/`--legacy` over `/repos` and `AGENT_TMPDIR`; full-disk recovery | `bash agent/scripts/host-storage.test.sh` |
| FR13 | Agent | `HarnessTicketProcessorStorageTest.java` | destroy before delete; failed destroy keeps dir | `mvn test` |

## Rollout

1. Ship the keyed layout/runtime-root sweep with the child/startup temp/own-root
   prune still in place.
2. Run the one-time `/repos` + temp `host-storage.sh --legacy` (or supervisor
   `/repos`-rooted) pass.
3. Retire the supervisor `/repos` legacy pass after the legacy dirs are gone
   (D10); keep the child/startup temp/own-root prune until it is migrated.

## Review checklist

- [ ] Every `FR*` acceptance statement has a passing row
- [ ] No cleanup can escape the runtime root (`toRealPath` + symlink refusal)
- [ ] No active lease/harness/sandbox or live `.active`/supervisor slot is deleted or stopped
- [ ] Sandbox destroy precedes workspace deletion
- [ ] Legacy/temp cleanup is preserved or migrated with tests (`pruneStaleTempDirectories` not dropped)
- [ ] No new `PoolManager`/`POOL_ADMIN_TOKEN` dependency; historical references are explanatory only
- [ ] `04` is the implementation contract; `Results` records as-built deviations

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-44-storage-lifecycle` | Agent 959 tests (storage 15); host-storage 12/12; host-init 78/78; Compose base+sandbox | Runtime/ticket keyed workspaces, keyed cleanup + active marker, storage policy/watermarks/log, budget guard, storage events, host-init budget/TTL env, host-storage recovery script and tests. |
