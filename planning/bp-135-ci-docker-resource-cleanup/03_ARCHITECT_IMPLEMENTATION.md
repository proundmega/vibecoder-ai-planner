# 03 — Implementation (bp-135)

> Lightweight suite: use with the lightweight `00`; requirements live there.

## Plan

1. **Build-scoped teardown** — change the pipeline cleanup from `post { success }` to `post { always }` and use `docker compose -p "$COMPOSE_PROJECT_NAME" down -v --rmi local --remove-orphans` — verify: failed smoke build leaves no project containers, network or locally built images.
2. **CI labels** — add `com.vibecode.ci=true`, `com.vibecode.ci.job` and `com.vibecode.ci.build` labels to the supervisor, sandbox, proxy and Compose images; use a build-unique tag where a shared `:ci` tag would be unsafe — verify: `docker image inspect` on each image; fake-docker script test asserts the labels.
3. **Cleanup script** — add `agent/scripts/jenkins-docker-cleanup.sh` with `--compose-project` (build teardown) and `--orphans` (scheduled GC); source `sandbox-ci-env.sh` for daemon/workspace selection; support `--dry-run` and grace-period env vars — verify: fake-docker test.
4. **Scheduled maintenance job** — add a small `Jenkinsfile.cleanup` (cron `H */6 * * *`, `DRY_RUN` parameter) that runs `--orphans` on the same agent label — verify: script test plus a documented dry-run.
5. **Guard rails** — refuse broad prune commands, preserve shared named volumes, skip resources younger than the grace period and avoid deleting a project with a running container — verify: negative assertions in the script test.
6. **Documentation/index** — document the retention values and the two-layer model; add the `PENDING.txt` row — verify: `node planning/check-planning.js`.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `Jenkinsfile` | MODIFY | `post { always }` Compose teardown; build labels; call cleanup on failure/abort. |
| `Jenkinsfile.cleanup` | CREATE | Scheduled orphan-GC pipeline with `DRY_RUN` and cron trigger. |
| `agent/scripts/jenkins-docker-cleanup.sh` | CREATE | Scoped cleanup for a Compose project and labelled/aged orphan resources. |
| `agent/scripts/sandbox-integration-test.sh` | MODIFY | Add CI labels to sandbox/proxy builds; accept a build-unique image tag. |
| `docker-compose*.yml` | MODIFY | Add `build.labels` for `com.vibecode.ci` and the project/build identifier. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsDockerCleanupScriptTest.java` | CREATE | Fake-docker coverage for teardown, orphan filters, dry-run, grace periods and volume protection. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxIntegrationScriptTest.java` | MODIFY | Assert the build labels/tags are passed. |
| `AGENTS.md`, `README.md` | MODIFY | Document the cleanup job, retention env vars and the no-broad-prune rule. |
| `PENDING.txt` | MODIFY | Add the `bp-135` row and label. |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Script | `JenkinsDockerCleanupScriptTest` | `composeProjectTeardownRemovesLocalImages` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR2 | Script | `SandboxIntegrationScriptTest` | `buildsBothImagesAndRunsTheDockerSuite` (label assertions) | `mvn -Dtest=SandboxIntegrationScriptTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `orphansRemovesOnlyOldLabelledResources` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR4 | Script | `JenkinsDockerCleanupScriptTest` | `dryRunAndGuardsNeverPruneBroadly` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `SandboxCiEnvScriptTest` / `JenkinsDockerCleanupScriptTest` | `usesTheSharedDaemonSelection` | `mvn -Dtest=SandboxCiEnvScriptTest,JenkinsDockerCleanupScriptTest test` |
| NFR1 | Script | `JenkinsDockerCleanupScriptTest` | `missingResourcesAreIdempotentAndNonFatal` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR2 | Script | `JenkinsDockerCleanupScriptTest` | `gracePeriodSkipsConcurrentBuildResources` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR3 | Script | `JenkinsDockerCleanupScriptTest` | `fakeDockerCoversAllCleanupPaths` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR4 | Script | `JenkinsDockerCleanupScriptTest` | `retentionValuesComeFromEnvironment` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |

## Verification commands

```bash
node planning/check-planning.js
cd agent && mvn test
cd agent && mvn -Dtest=JenkinsDockerCleanupScriptTest,SandboxIntegrationScriptTest,SandboxCiEnvScriptTest test
```

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | pending | pending | pending | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| pending | pending | pending | pending |
