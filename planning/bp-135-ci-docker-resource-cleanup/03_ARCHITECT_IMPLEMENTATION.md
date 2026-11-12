# 03 — Implementation (bp-135)

> Lightweight suite: use with the lightweight `00`; requirements live there.

## Plan

1. **Fix the post ordering first** — in `Jenkinsfile`, move the top-level Compose
   teardown from `post { success { ... } }` to the start of `post { always { ... } }`
   and move `cleanWs()` to `post { cleanup { ... } }`. Remove the old
   success-only cleanup. Add a boolean `CI_SMOKE_FAIL` parameter (default
   `false`) and a final stage that calls `error` only when it is set, so both the
   success and forced-failure paths can be exercised. — verify:
   `JenkinsfileCiCleanupTest` static assertions plus a successful control build
   and a `CI_SMOKE_FAIL=1` build.

2. **CI labels and build-unique tags** — add
   `com.vibecode.ci=true`, `com.vibecode.ci.job` and `com.vibecode.ci.build` to
   the supervisor build, the sandbox/proxy builds and every Compose-built
   image. Export `VIBECODE_CI=true`, `VIBECODE_CI_JOB` and
   `VIBECODE_CI_BUILD` from the Jenkinsfile. Tag the supervisor, sandbox and
   proxy as both `:ci` and `:<BUILD_NUMBER>`; Compose images are already unique
   by project name. Compose labels use environment interpolation with local-dev
   defaults (`VIBECODE_CI=false`, empty job/build), so local images are not
   classified as CI. Add the same labels to the Compose network and volumes so
   a project is identifiable even after its containers exit. — verify:
   `SandboxIntegrationScriptTest`, `JenkinsfileCiCleanupTest`, and
   `docker image inspect` during the smoke build.

3. **Cleanup script** — add `agent/scripts/jenkins-docker-cleanup.sh`:
   - Source `agent/scripts/sandbox-ci-env.sh` for daemon selection; the
     scheduled mode sets `SANDBOX_CI_DOCKER_HOST_MODE=explicit` first.
   - `--compose-project <name> --build-id <id>` validates the strict CI project
     pattern (`^vibecode-[a-z0-9][a-z0-9-]*-[0-9]+$`), refuses
     `vibecoder-ai-planner`, verifies `com.vibecode.ci=true` on the project's
     services/network/volumes, then runs
     `docker compose -f docker-compose.yml -f docker-compose.test.yml
     -f docker-compose.e2e.yml --profile e2e -p <name> down -v --rmi local
     --remove-orphans` so the API/frontend, test and Cypress images are all in
     scope.
   - `--build-images <id>` removes only the exact build tags whose
     `com.vibecode.ci.build` label matches the current build; it never removes
     the shared `:ci` alias or another build's tags.
   - `--orphans` runs the scheduled GC: sandbox containers/networks with
     `vibecode.sandbox.managed=true`, CI images with `com.vibecode.ci=true` and
     an old build ID, and stopped Compose projects matching the strict pattern.
     The exact shared volume names (`postgres_data`, `uploads_data`,
     `vibecode_repos`) are refused regardless of labels.
   - `--dry-run`, `--docker-host`, `--daemon-id` and grace-period environment
     variables. Post mode is best-effort and exits 0; scheduled mode exits
     non-zero on any failure. — verify: `JenkinsDockerCleanupScriptTest`.

4. **Explicit daemon mode** — extend `agent/scripts/sandbox-ci-env.sh` with
   `SANDBOX_CI_DOCKER_HOST_MODE=explicit` (default `auto` keeps today's
   local-socket preference). In explicit mode the helper requires the supplied
   `DOCKER_HOST`, only resolves the TCP hostname, and never falls back to
   `unix:///var/run/docker.sock`; an empty host is an error. The scheduled
   cleanup uses explicit mode, verifies `docker info --format '{{.ID}}'` against
   `CI_DOCKER_DAEMON_ID`, and aborts before listing or deleting anything if the
   host is missing or the ID differs. — verify: `SandboxCiEnvScriptTest` and
   `JenkinsDockerCleanupScriptTest`.

5. **Scheduled maintenance job** — add `Jenkinsfile.cleanup` with
   `agent { label 'vibecode-ci-docker' }`, a six-hour cron trigger and
   parameters for `DRY_RUN`, `CI_DOCKER_HOST`, `CI_DOCKER_DAEMON_ID` and the
   grace periods. The first manual run is `DRY_RUN=true`; the cron definition is
   only active after an administrator provisions the Jenkins job. — verify:
   `JenkinsfileCiCleanupTest` plus the runbook procedure.

6. **Guard rails** — no broad prune, no name-prefix-only filters, no shared
   volume removal, no current build, no running container and no resource
   younger than the grace period. A project with a running container is left
   alone. The local-dev project is an explicit deny. — verify: negative
   assertions in `JenkinsDockerCleanupScriptTest`.

7. **Documentation, runbook and index** — document the two-layer model, the
   provisioning prerequisite, retention values, manual dry-run and rollback in
   `05_RUNBOOK.md`; update `README.md`, `AGENTS.md` and the `PENDING.txt` row.
   — verify: `node planning/check-planning.js` and a runbook-defaults check.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `Jenkinsfile` | MODIFY | Teardown first in `post { always }`; `cleanWs()` in `post { cleanup }`; remove success-only cleanup; add `CI_SMOKE_FAIL`; add CI labels/tags; call the cleanup script for the current project and current build images; pin the pipeline to the dedicated `vibecode-ci-docker` node label. |
| `Jenkinsfile.cleanup` | CREATE | Scheduled orphan-GC pipeline with dedicated node label, cron, `DRY_RUN`, explicit host/daemon ID and grace-period parameters. |
| `agent/scripts/jenkins-docker-cleanup.sh` | CREATE | Scoped teardown/build-image removal and label/age-scoped orphan GC; dry-run and daemon verification. |
| `agent/scripts/sandbox-ci-env.sh` | MODIFY | Add explicit-daemon mode that never substitutes the local socket. |
| `agent/scripts/sandbox-integration-test.sh` | MODIFY | Add CI labels and build-unique tags to the sandbox/proxy builds. |
| `docker-compose.yml` | MODIFY | Add `build.labels` to `migrate`, `api`, `frontend`; label `default` network and the three volumes with the CI metadata. |
| `docker-compose.test.yml` | MODIFY | Add `build.labels` to the `test` image. |
| `docker-compose.e2e.yml` | MODIFY | Add `build.labels` to the `cypress` image. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsDockerCleanupScriptTest.java` | CREATE | Fake-Docker coverage for compose teardown, build-image removal, orphan filters, dry-run, grace periods, daemon checks and volume protection. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsfileCiCleanupTest.java` | CREATE | Static assertions for post ordering, `cleanWs()` placement, labels, smoke hook and scheduled-job wiring. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxIntegrationScriptTest.java` | MODIFY | Assert the CI labels and build-unique tags are passed. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxCiEnvScriptTest.java` | MODIFY | Cover `SANDBOX_CI_DOCKER_HOST_MODE=explicit`. |
| `planning/bp-135-ci-docker-resource-cleanup/05_RUNBOOK.md` | CREATE | Provisioning, retention defaults, dry-run, inspect, recovery and rollback. |
| `AGENTS.md`, `README.md` | MODIFY | Document the cleanup job, retention env vars, dedicated node and the no-broad-prune rule. |
| `PENDING.txt` | MODIFY | Keep the `bp-135` row and label aligned with this suite. |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Static | `JenkinsfileCiCleanupTest` | `fr1TeardownRunsBeforeCleanWsInPostAlways` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR1 | Static | `JenkinsfileCiCleanupTest` | `fr1CleanWsRunsInPostCleanup` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR1 | Smoke | Jenkins smoke build | `fr1FailedSmokeBuildLeavesNoComposeProject` (record in `03` Results) | `CI_SMOKE_FAIL=1` build, then `docker ps -a`, `docker network ls`, `docker volume ls` and `docker images` filtered by the build project |
| FR2 | Script | `SandboxIntegrationScriptTest` | `fr2SandboxAndProxyBuildsCarryCiLabelsAndBuildTag` | `mvn -Dtest=SandboxIntegrationScriptTest test` |
| FR2 | Static | `JenkinsfileCiCleanupTest` | `fr2SupervisorAndComposeBuildsCarryCiLabels` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphansRemovesOnlyOldLabelledResources` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR4 | Script | `JenkinsDockerCleanupScriptTest` | `fr4CleanupNeverPrunesBroadlyOrTouchesLocalDev` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5RequiresPinnedDaemonAndRejectsMismatch` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Static | `JenkinsfileCiCleanupTest` | `fr5ScheduledJobPinsNodeAndDaemon` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| NFR1 | Script | `JenkinsDockerCleanupScriptTest` | `nfr1MissingResourcesAreIdempotentAndPostModeNonFatal` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR2 | Script | `JenkinsDockerCleanupScriptTest` | `nfr2GraceAndBuildIdSkipConcurrentBuildResources` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR3 | Script | `JenkinsDockerCleanupScriptTest` | `nfr3FakeDockerCoversAllCleanupPaths` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR4 | Script | `JenkinsDockerCleanupScriptTest` | `nfr4RetentionValuesComeFromEnvironment` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR4 | Docs | `05_RUNBOOK.md` | `nfr4RunbookDocumentsTheSameDefaults` | `grep` the defaults in `05_RUNBOOK.md` and `README.md` |

## Verification commands

```bash
node planning/check-planning.js
cd agent && mvn -Dtest=JenkinsDockerCleanupScriptTest,JenkinsfileCiCleanupTest,SandboxIntegrationScriptTest,SandboxCiEnvScriptTest test
cd agent && mvn test
```

Jenkins smoke evidence (manual, recorded in Results):

```bash
# control build: no CI_SMOKE_FAIL
# forced-failure build: CI_SMOKE_FAIL=1
docker ps -a --filter label=com.docker.compose.project="$COMPOSE_PROJECT_NAME"
docker network ls --filter label=com.docker.compose.project="$COMPOSE_PROJECT_NAME"
docker volume ls --filter label=com.docker.compose.project="$COMPOSE_PROJECT_NAME"
docker images --filter label=com.vibecode.ci.build="$BUILD_NUMBER"
```

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | author | none | Initial lightweight plan | n/a |
| 1 | external reviewer | B1 post ordering could still no-op after `cleanWs()`; B2 `down -v` contradicted shared-volume protection; B3 scheduled GC daemon/selectors were not deterministic or positive; B4 plan was stale relative to #140. Should-fix: FR2/FR1 traceability, sandbox/proxy images outside Compose teardown, existing sandbox label, missing runbook, Jenkins job provisioning, D1 follow-up, pending decisions and test-name IDs. | This revision: FR1 now fixes ordering explicitly and adds a smoke hook; FR4/decision 4 define the validated build-scoped volume policy and explicit local-dev deny; FR3/FR5/decision 5 use positive labels and a pinned host/daemon ID; D4 records #140 as merged; every should-fix item is mapped above. | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| pending | pending | pending | pending |
