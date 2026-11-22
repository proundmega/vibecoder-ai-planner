# 04 — Specification (fg-44)

> **Owns:** exact file operations, signatures and contracts.
> **Not here:** design rationale (`02`), requirements (`01`), verification
> matrix (`03`), status (`00`).

Execution order: test stubs, workspace layout, ticket cleanup, supervisor
storage policy, host script, verify the existing supervisor logs, docs.

## 1. Test stubs

| File | Initial contents |
|---|---|
| `agent/src/test/java/.../service/WorkspaceManagerStorageTest.java` | Layout `<runtime>/<ticket>/repo`, `tmp/`/`logs/`/`cache/`, keyed cleanup/size, traversal/symlink/non-existent and legacy-prefix refusal |
| `agent/src/test/java/.../supervisor/SupervisorStorageTest.java` | idle/max-lifetime/watermarks/runtime-root + legacy sweep/active safety/budget |
| `agent/src/test/java/.../harness/HarnessTicketProcessorStorageTest.java` | cleanup order, `.active` preserved on failure, budget breach |
| `agent/src/test/java/.../harness/HarnessEventStorageTest.java` | workspace bytes/inodes, free bytes/inodes, log bytes, refresh/cleanup/orphan counts |
| `agent/scripts/host-storage.test.sh` | Bash fixtures for dry-run/apply/`--legacy` over `/repos` and `AGENT_TMPDIR`, stopped-supervisor and `.active`/PID guards |

## Test-First Requirement

Create the test stubs in §1 before production code, implement the production
code, then fill the stubs with assertions. The as-built results are recorded in
`03`.

## 2. `WorkspaceManager` contract

Add a workspace key without breaking existing callers:

```java
public WorkspaceManager(String repoCloneDir, String repoName, boolean dryRun,
                        String githubToken, GitHubTokenSource tokenSource) {
    this(repoCloneDir, repoName, dryRun, githubToken, tokenSource, null);
}

public WorkspaceManager(..., String workspaceKey) { ... }

public void setWorkspaceKey(String workspaceKey);   // ticket id or uuid
public Path getWorkspaceRoot();                     // <repoCloneDir>/<key> (ticket root)
public Path getRepoDir();                           // <getWorkspaceRoot()>/repo
public Path getCacheDir();                          // <runtimeRoot>/cache
public void writeActiveMarker(String runId);        // <ticketRoot>/.active
public void cleanup(String workspaceKey);           // delete the ticket root incl. .active
public void cleanupRuntime();                       // delete the runtime root incl. cache
public long workspaceBytes();                       // du -sb of the ticket root
public long workspaceInodes();                      // bounded walk of the ticket root
```

`generateRepoDir()`:

```java
String key = workspaceKey == null || workspaceKey.isBlank()
    ? UUID.randomUUID().toString().substring(0, 8) + "-" + sanitizePath(repoName)
    : sanitizePath(workspaceKey);
return Paths.get(repoCloneDir, key, "repo").toAbsolutePath().normalize();
```

`getWorkspaceRoot()` is `<repoCloneDir>/<key>` (the ticket root);
`generateRepoDir()` is its `repo/` child. The manager creates `tmp/` and `logs/`
under the ticket root before clone and `cache/` under the runtime root.
`cleanup(key)` deletes the ticket root (including `.active`); `cleanupRuntime()`
deletes the runtime root including `cache/`. The cache uses the same
`HARNESS_WORKSPACE_RETENTION_HOURS` TTL. The clone is never the delete root.

The existing Java prune methods remain for the child/startup path:
`pruneStaleWorkspaces()` scans the clone root (`/repos`) for the
`WORKSPACE_DIR_PATTERN` (`<8hex>-*`); `pruneStaleTempDirectories()` scans
`java.io.tmpdir` for `TEMP_DIR_PREFIXES`
(`opencode-harness-*`/`vibecode-askpass-*`). The supervisor runtime-root sweep
uses the Java methods for the normal path. `host-storage.sh --legacy`
reimplements the same find/prefix/retention rules in bash over `/repos` and
`${AGENT_TMPDIR:-${TMPDIR:-/tmp}}`; it does not call Java. Do not remove
`pruneStaleTempDirectories`: the temp dirs may contain credentials. In Docker
mode, `AGENT_TMPDIR` must point at the host path the child sees as
`java.io.tmpdir`, or rely on the in-container child/startup prune.

`assertSafeToDelete` currently uses `toAbsolutePath().normalize()`. fg-44 must
change it to `toRealPath(LinkOption.NOFOLLOW_LINKS)` for existing paths and a
normalized, non-following check for a path that does not exist yet. It refuses
any target outside `cloneRoot`; symlinks are not followed. Tests must cover
symlink, traversal and non-existent targets.

The supervisor passes `REPO_CLONE_DIR=/repos/runtimes/<runtimeId>` to each
child. `HarnessTicketProcessor` calls `setWorkspaceKey(ticketId)` before clone,
writes `<ticketRoot>/.active` at run start and clears it in terminal cleanup.

## 3. Cleanup order

```
run start
  -> workspaceManager.writeActiveMarker(runId)   // <ticketRoot>/.active

finish run (terminal state)
  -> destroy sandbox (DockerSandboxRunner.close/destroy)
  -> verify destroy (fail closed on failure)
  -> release lease (finish endpoint)
  -> workspaceManager.cleanup(ticketId)   // deletes the ticket root incl. .active
  -> emit storage.cleanup (freed bytes, duration, reason)
```

If the sandbox destroy fails: keep the workspace and marker, emit
`storage.cleanup_failed`, and let the supervisor/orphan sweep retry after TTL. A
marker whose run is terminal and whose lease has expired is stale; the sweep may
remove it only after the retention TTL. Never delete a directory with a live
`.active` marker or a supervisor slot.

## 4. `StoragePolicy` contract

`agent/src/main/java/.../supervisor/StoragePolicy.java`:

```java
public record StoragePolicy(
    long idleRefreshMs,          // AGENT_IDLE_REFRESH_MS (2h)
    int maxLifetimeHours,        // AGENT_MAX_LIFETIME_HOURS (24)
    int warnPct,                 // 70
    int stopPct,                 // 80
    int cleanPct,                // 85
    int recyclePct,              // 90
    int manualPct,               // 95
    long workspaceTtlHours,      // HARNESS_WORKSPACE_RETENTION_HOURS (24)
    long orphanTtlHours          // AGENT_ORPHAN_TTL_HOURS (24)
) {
    static StoragePolicy fromEnv(Map<String,String> env);
    static long budgetGbFor(String role, String override); // role default or AGENT_DISK_BUDGET_GB
    StorageAction evaluate(Usage usage, RuntimeState state);
}

public record RuntimeState(
    String role,            // worker/reviewer/planner/light
    long budgetGb,          // budgetGbFor(role, AGENT_DISK_BUDGET_GB)
    boolean activeTicket,
    boolean activeLease,
    boolean sandboxActive,
    boolean harnessActive,
    Instant lastActivityAt,
    Instant startedAt
) {}
```

`StorageAction` is one of `OK`, `WARN`, `STOP_SPAWN`, `CLEAN_IDLE`,
`RECYCLE_OLDEST`, `MANUAL_RECOVERY`. `evaluate` uses the role/budget and returns
`CLEAN_IDLE` only when `activeTicket`, `activeLease`, `sandboxActive` and
`harnessActive` are all false. The idle runtime child is the process the
supervisor restarts, not a reason to keep the workspace. A failed refresh is a
supervisor `DEGRADED` state and a `storage.refresh_failed` event, not a
`StorageAction`.

## 5. Environment

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_IDLE_REFRESH_MS` | `7200000` | idle refresh threshold |
| `AGENT_MAX_LIFETIME_HOURS` | `24` | max runtime lifetime between tickets |
| `AGENT_STORAGE_CHECK_SECONDS` | `60` | watermark sample interval |
| `AGENT_STORAGE_METER_SECONDS` | `300` | `du`/inode meter interval |
| `HARNESS_WORKSPACE_RETENTION_HOURS` | `24` | workspace retention/orphan-root TTL (existing; single TTL); fg-44 makes `host-init.sh` write it when set |
| `AGENT_ORPHAN_TTL_HOURS` | `24` | quarantine TTL |
| `AGENT_DISK_BUDGET_GB` | role profile | optional budget override; fg-44 makes `host-init.sh` write it; supervisor passes it to the child |
| `AGENT_STORAGE_WARN_PCT` | `70` | warn |
| `AGENT_STORAGE_STOP_PCT` | `80` | stop spawning |
| `AGENT_STORAGE_CLEAN_PCT` | `85` | clean idle |
| `AGENT_STORAGE_RECYCLE_PCT` | `90` | emergency recycle |
| `AGENT_STORAGE_MANUAL_PCT` | `95` | manual recovery |
| `AGENT_LOG_MAX_SIZE` | `10m` | supervisor log rotation (already configured) |
| `AGENT_LOG_MAX_FILE` | `3` | supervisor log files |

The role budgets come from fg-43: worker 20 GB, reviewer/planner 10 GB, light
5 GB. `AGENT_WORKSPACE_TTL_HOURS` is **not** a new knob:
`HARNESS_WORKSPACE_RETENTION_HOURS` is the single workspace TTL.
`AGENT_DISK_BUDGET_GB` is the only budget override; there is no
`AGENT_WORKSPACE_BUDGET_GB`. fg-44 makes `host-init.sh` write both
`AGENT_DISK_BUDGET_GB` and `HARNESS_WORKSPACE_RETENTION_HOURS` to
`.env.agent-host` when set, and Compose passes both to the supervisor.

## 6. `agent/scripts/host-storage.sh`

```
Usage: host-storage.sh [--dry-run|--apply] [--orphans] [--legacy] [--images] [--json]
Exit codes:
  0  success
  2  invalid arguments
  3  repo path/Docker unavailable
  4  live supervisor/PID/.active marker prevented an action
  5  apply failed or free space/inodes remain critical
```

- Default is `--dry-run`; `--apply` is required to delete.
- `--apply` is a **stopped-supervisor recovery mode**: it refuses a live
  supervisor PID/slot or a `.active` marker (`exit 4`). The supervisor remains
  the lease-safe cleanup owner during normal operation.
- `--orphans` sweeps runtime roots with no live supervisor/PID/marker and older
  than `HARNESS_WORKSPACE_RETENTION_HOURS`; `--legacy` reimplements the same
  find/prefix/retention rules in bash over `/repos` (`<8hex>-*`,
  `WORKSPACE_DIR_PATTERN`) and `${AGENT_TMPDIR:-${TMPDIR:-/tmp}}`
  (`opencode-harness-*`/`vibecode-askpass-*`, `TEMP_DIR_PREFIXES`). It does not
  call Java; the child/startup Java prune remains until D10. `--images` prunes
  dangling images only.
- `--json` prints a machine-readable summary.
- It never reads or prints provider keys or a control token. It cannot see
  backend leases, so it does not claim lease-safe deletion while the supervisor
  is running. The `.active` marker is written by `HarnessTicketProcessor`; a
  terminal run's stale marker is ignored only after retention.

## 7. Events

Add to `HarnessEvent`/the sink:

- `storage.workspace` `{ runtimeId, ticketId, bytes, inodes }`
- `storage.cleanup` `{ runtimeId, ticketId, bytes, reason }`
- `storage.cleanup_failed` `{ runtimeId, ticketId, error }`
- `storage.refresh` `{ runtimeId, reason, freedBytes }`
- `storage.refresh_failed` `{ runtimeId, error }`
- `storage.watermark` `{ level, freeBytes, usedPct, freeInodes, inodePct }`
- `storage.log_bytes` `{ component, bytes }`
- `storage.budget_exceeded` `{ runtimeId, ticketId, budgetGb, usedGb }`
- `storage.orphan` `{ path, bytes, action }`
- `storage.image_prune` `{ removed, reclaimedBytes }`

Payloads are redacted (fg-42) and never include file contents.

## 8. Compose

```yaml
logging:
  driver: json-file
  options:
    max-size: ${AGENT_LOG_MAX_SIZE:-10m}
    max-file: ${AGENT_LOG_MAX_FILE:-3}
```

The supervisor Compose service already has this rotation (10m/3); this ticket
verifies it. Sandbox/proxy containers are created by `DockerSandboxRunner` with
bounded 1m/1 log options; there is no sandbox Compose service. Configurable
sandbox rotation is deferred as D9.

## 9. Verification commands

```bash
cd agent && mvn test -Dtest=WorkspaceManagerStorageTest,SupervisorStorageTest,HarnessTicketProcessorStorageTest,HarnessEventStorageTest,DockerSandboxRunnerTest
bash agent/scripts/host-storage.test.sh
bash agent/scripts/host-init.test.sh
docker compose -f agent/docker-compose.yml config
docker compose -f agent/docker-compose.yml -f agent/docker-compose.sandbox.yml config
node planning/check-planning.js
git diff --check
```
