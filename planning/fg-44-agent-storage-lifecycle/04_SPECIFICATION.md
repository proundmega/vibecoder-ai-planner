# 04 — Specification (fg-44)

> **Owns:** exact file operations, signatures and contracts.
> **Not here:** design rationale (`02`), requirements (`01`), verification
> matrix (`03`), status (`00`).

Execution order: test stubs, workspace layout, ticket cleanup, supervisor
storage policy, host script, Compose logs, docs.

## 1. Test stubs

| File | Initial contents |
|---|---|
| `agent/src/test/java/.../service/WorkspaceManagerStorageTest.java` | JUnit placeholders for path/key/cleanup/size/traversal |
| `agent/src/test/java/.../supervisor/SupervisorStorageTest.java` | idle/max-lifetime/watermarks/orphans/active safety |
| `agent/src/test/java/.../harness/HarnessTicketProcessorStorageTest.java` | cleanup order and budget breach |
| `agent/scripts/host-storage.test.sh` | Bash fixtures for dry-run/apply/recovery |

## 2. `WorkspaceManager` contract

Add a workspace key without breaking existing callers:

```java
public WorkspaceManager(String repoCloneDir, String repoName, boolean dryRun,
                        String githubToken, GitHubTokenSource tokenSource) {
    this(repoCloneDir, repoName, dryRun, githubToken, tokenSource, null);
}

public WorkspaceManager(..., String workspaceKey) { ... }

public void setWorkspaceKey(String workspaceKey);   // ticket id or uuid
public Path getWorkspaceRoot();                     // <repoCloneDir>/<key>
public void cleanup(String workspaceKey);           // delete only that key
public void cleanupRuntime();                       // delete the runtime root
public long workspaceBytes();                       // du -sb equivalent
public long workspaceInodes();                      // bounded walk
```

`generateRepoDir()`:

```java
String key = workspaceKey == null || workspaceKey.isBlank()
    ? UUID.randomUUID().toString().substring(0, 8) + "-" + sanitizePath(repoName)
    : sanitizePath(workspaceKey);
return Paths.get(repoCloneDir, key).toAbsolutePath().normalize();
```

All delete paths call `assertSafeToDelete(path)` and refuse a target outside
`cloneRoot` after `toRealPath()`; symlinks are not followed.

The supervisor passes `REPO_CLONE_DIR=/repos/runtimes/<runtimeId>` to each
child. `HarnessTicketProcessor` calls `setWorkspaceKey(ticketId)` before clone.

## 3. Cleanup order

```
finish run (terminal state)
  -> destroy sandbox (DockerSandboxRunner.close/destroy)
  -> verify destroy (fail closed on failure)
  -> release lease (finish endpoint)
  -> workspaceManager.cleanup(ticketId)
  -> emit storage.cleanup (freed bytes, duration, reason)
```

If the sandbox destroy fails: keep the workspace, emit
`storage.cleanup_failed`, and let the orphan sweep retry after TTL. Never delete
a directory with an active `.active` marker or a supervisor slot.

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
    long workspaceTtlHours,      // AGENT_WORKSPACE_TTL_HOURS (24)
    long orphanTtlHours          // AGENT_ORPHAN_TTL_HOURS (24)
) {
    static StoragePolicy fromEnv(Map<String,String> env);
    StorageAction evaluate(Usage usage, RuntimeState state);
}
```

`StorageAction` is one of `OK`, `WARN`, `STOP_SPAWN`, `CLEAN_IDLE`,
`RECYCLE_OLDEST`, `MANUAL_RECOVERY`.

## 5. Environment

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_IDLE_REFRESH_MS` | `7200000` | idle refresh threshold |
| `AGENT_MAX_LIFETIME_HOURS` | `24` | max runtime lifetime between tickets |
| `AGENT_STORAGE_CHECK_SECONDS` | `60` | watermark sample interval |
| `AGENT_STORAGE_METER_SECONDS` | `300` | `du`/inode meter interval |
| `AGENT_WORKSPACE_TTL_HOURS` | `24` | orphan root TTL |
| `AGENT_ORPHAN_TTL_HOURS` | `24` | quarantine TTL |
| `AGENT_WORKSPACE_BUDGET_GB` | role profile | optional budget override |
| `AGENT_STORAGE_WARN_PCT` | `70` | warn |
| `AGENT_STORAGE_STOP_PCT` | `80` | stop spawning |
| `AGENT_STORAGE_CLEAN_PCT` | `85` | clean idle |
| `AGENT_STORAGE_RECYCLE_PCT` | `90` | emergency recycle |
| `AGENT_STORAGE_MANUAL_PCT` | `95` | manual recovery |
| `AGENT_LOG_MAX_SIZE` | `10m` | Docker log rotation |
| `AGENT_LOG_MAX_FILE` | `3` | Docker log files |

The role budgets come from fg-43: worker 20 GB, reviewer/planner 10 GB, light
5 GB.

## 6. `agent/scripts/host-storage.sh`

```
Usage: host-storage.sh [--dry-run|--apply] [--orphans] [--images] [--json]
Exit codes:
  0  success
  2  invalid arguments
  3  repo path/Docker unavailable
  4  active lease/process prevented an action
  5  apply failed or free space/inodes remain critical
```

- Default is `--dry-run`; `--apply` is required to delete.
- `--orphans` sweeps `/repos/runtimes/*` with no active runtime/lease and older
  than TTL; `--images` prunes dangling images only.
- `--json` prints a machine-readable summary.
- It never reads or prints provider keys or a control token.

## 7. Events

Add to `HarnessEvent`/the sink:

- `storage.workspace` `{ runtimeId, ticketId, bytes, inodes }`
- `storage.cleanup` `{ runtimeId, ticketId, bytes, reason }`
- `storage.cleanup_failed` `{ runtimeId, ticketId, error }`
- `storage.refresh` `{ runtimeId, reason, freedBytes }`
- `storage.watermark` `{ level, usedPct, inodePct }`
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

Apply to the supervisor and sandbox services. Host mode has no sandbox service;
the supervisor still gets rotation.

## 9. Verification commands

```bash
cd agent && mvn test -Dtest=WorkspaceManagerStorageTest,SupervisorStorageTest,HarnessTicketProcessorStorageTest
bash agent/scripts/host-storage.test.sh
docker compose -f agent/docker-compose.yml config
docker compose -f agent/docker-compose.yml -f agent/docker-compose.sandbox.yml config
node planning/check-planning.js
git diff --check
```
