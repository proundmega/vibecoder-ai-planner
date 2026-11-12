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
   - Source `agent/scripts/sandbox-ci-env.sh` in explicit-daemon mode for both
     post and scheduled cleanup; never use the helper's local-socket auto mode
     for deletion.
   - `--compose-project <name> --build-id <id>` validates the strict CI project
     pattern (`^vibecode-[a-z0-9][a-z0-9-]*-[0-9]+$`), refuses
     `vibecoder-ai-planner`, and verifies the authoritative project anchor:
     `com.vibecode.ci=true` plus `com.docker.compose.project=<name>` on the
     project network or a named volume. Pulled services (redis, postgres,
     docker-proxy) do not need build labels. It then runs
     `docker compose -f docker-compose.yml -f docker-compose.test.yml
     -f docker-compose.e2e.yml --profile e2e -p <name> down -v --rmi local
     --remove-orphans` so the API/frontend, test and Cypress images are all in
     scope.
   - `--build-images <id>` removes only the exact build tags whose
     `com.vibecode.ci.build` label matches the current build; it never removes
     the shared `:ci` alias or another build's tags.
   - `--orphans` runs the scheduled GC: sandbox containers/networks with
     `vibecode.sandbox.managed=true`, CI images with `com.vibecode.ci=true` and
     an old build ID, and stopped Compose projects matching the strict pattern
     with the network/volume anchor. It skips the shared `:ci` alias, the
     current build ID and images referenced by a running container. The exact
     shared volume names (`postgres_data`, `uploads_data`, `vibecode_repos`)
     are refused regardless of labels.
   - `--legacy-inventory` is read-only. It lists pre-label candidates from old
     `vibecode-*` Compose projects, `vibecode-*`/`:ci` images and the existing
     sandbox label without requiring the new labels; it marks
     `vibecoder-ai-planner` and the exact shared volumes as excluded and never
     issues a delete, prune or `compose down`.
   - `--dry-run`, `--docker-host`, `--daemon-id` and grace-period environment
     variables. Post mode is best-effort and exits 0; scheduled mode exits
     non-zero on any failure. — verify: `JenkinsDockerCleanupScriptTest`.

4. **Explicit daemon mode and build-daemon record** — extend
   `agent/scripts/sandbox-ci-env.sh` with
   `SANDBOX_CI_DOCKER_HOST_MODE=explicit` (default `auto` keeps today's
   local-socket preference). In explicit mode the helper requires the supplied
   `DOCKER_HOST`, only resolves the TCP hostname, and never falls back to
   `unix:///var/run/docker.sock`; an empty host is an error. Set
   `SANDBOX_CI_DOCKER_HOST_MODE=explicit` in the Jenkins pipeline environment so
   the Agent, Sandbox and Supply Chain stages use the same `DOCKER_HOST` as the
   Cypress and Integration Tests stages instead of choosing a local socket.
   Immediately before the first `docker compose` command in the Integration
   Tests stage, `mkdir -p target` and write `target/ci-docker-daemon.env` with
   `CI_DOCKER_HOST`, `CI_DOCKER_DAEMON_ID="$(docker info --format '{{.ID}}')"`
   and `CI_BUILD_NUMBER`.
   In `post { always }`, prefer that file only when its build number matches the
   current build, set explicit mode, verify the daemon ID and only then call the
   cleanup script. If the record is missing or stale (for example an early-stage
   failure or a reused workspace), use the Jenkins `DOCKER_HOST` in explicit
   mode and compute the ID; if both are missing, log a warning and skip. Never
   guess a daemon or use the local socket. The scheduled cleanup uses the same
   explicit mode with its own `CI_DOCKER_HOST`/`CI_DOCKER_DAEMON_ID` and aborts
   before listing or deleting anything on a mismatch. — verify:
   `SandboxCiEnvScriptTest`, `JenkinsDockerCleanupScriptTest` and
   `JenkinsfileCiCleanupTest`.

5. **Scheduled maintenance job** — add `Jenkinsfile.cleanup` with
   `agent { label 'vibecode-ci-docker' }`, a six-hour cron trigger and
   parameters for `DRY_RUN`, `CI_DOCKER_HOST`, `CI_DOCKER_DAEMON_ID` and the
   grace periods. The first manual run is `DRY_RUN=true`; the cron definition is
   only active after an administrator provisions the Jenkins job. — verify:
   `JenkinsfileCiCleanupTest` plus the runbook procedure.

6. **Guard rails** — no broad prune, no name-prefix-only filters, no shared
   volume removal, no current build, no running container and no resource
   younger than the grace period. The project network/volume CI label is the
   authoritative anchor; pulled services do not need a build label. A project
   with a running container is left alone. The local-dev project is an explicit
   deny. Pre-label resources are never removed by the automatic path; only the
   manual legacy inventory/cleanup procedure (FR6) may handle them. — verify:
   negative assertions in `JenkinsDockerCleanupScriptTest`.

7. **Documentation, runbook and index** — document the two-layer model, the
   provisioning prerequisite, retention values, manual dry-run and rollback in
   `05_RUNBOOK.md`. Add the one-time legacy backlog procedure: read-only
   inventory without new-label filters, candidate classification, dry-run
   command list, explicit confirmation and evidence record. Update `README.md`,
   `AGENTS.md` and the `PENDING.txt` row. — verify:
   `node planning/check-planning.js`, a runbook-defaults check and the FR6
   documentation test.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `Jenkinsfile` | MODIFY | Teardown first in `post { always }`; `cleanWs()` in `post { cleanup }`; remove success-only cleanup; add `CI_SMOKE_FAIL`; set explicit-daemon mode for all Docker stages so they share `DOCKER_HOST`; record the Integration Tests daemon host/ID in `target/ci-docker-daemon.env`; load it and use explicit mode in post cleanup; add CI labels/tags; call the cleanup script for the current project and current build images. Do not change the main pipeline's agent label. |
| `Jenkinsfile.cleanup` | CREATE | Scheduled orphan-GC pipeline with dedicated node label, cron, `DRY_RUN`, explicit host/daemon ID and grace-period parameters. |
| `agent/scripts/jenkins-docker-cleanup.sh` | CREATE | Scoped teardown/build-image removal, label/age-scoped orphan GC and read-only `--legacy-inventory`; dry-run and daemon verification. |
| `agent/scripts/sandbox-ci-env.sh` | MODIFY | Add explicit-daemon mode that never substitutes the local socket. |
| `agent/scripts/sandbox-integration-test.sh` | MODIFY | Add CI labels and build-unique tags to the sandbox/proxy builds. |
| `docker-compose.yml` | MODIFY | Add `build.labels` to `migrate`, `api`, `frontend`; label `default` network and the three volumes with the CI metadata. |
| `docker-compose.test.yml` | MODIFY | Add `build.labels` to the `test` image. |
| `docker-compose.e2e.yml` | MODIFY | Add `build.labels` to the `cypress` image. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsDockerCleanupScriptTest.java` | CREATE | Fake-Docker coverage for compose teardown, build-image removal, orphan filters, `:ci` alias protection, dry-run, grace periods, daemon checks, volume protection and legacy inventory. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsfileCiCleanupTest.java` | CREATE | Static assertions for post ordering, `cleanWs()` placement, daemon record/read, labels, smoke hook and scheduled-job wiring. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxIntegrationScriptTest.java` | MODIFY | Assert the CI labels and build-unique tags are passed. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxCiEnvScriptTest.java` | MODIFY | Cover `SANDBOX_CI_DOCKER_HOST_MODE=explicit`. |
| `planning/bp-135-ci-docker-resource-cleanup/05_RUNBOOK.md` | CREATE | Provisioning, retention defaults, dry-run, inspect, legacy backlog procedure, recovery and rollback. |
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
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphanGcKeepsSharedCiAlias` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR4 | Script | `JenkinsDockerCleanupScriptTest` | `fr4CleanupNeverPrunesBroadlyOrTouchesLocalDev` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5RequiresPinnedDaemonAndRejectsMismatch` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5PostCleanupUsesRecordedBuildDaemon` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5PostCleanupFallsBackToExplicitHost` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5StaleDaemonRecordIsIgnored` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Static | `JenkinsfileCiCleanupTest` | `fr5ScheduledJobPinsNodeAndDaemon` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR5 | Static | `JenkinsfileCiCleanupTest` | `fr5PostCleanupReadsDaemonRecord` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR6 | Script | `JenkinsDockerCleanupScriptTest` | `fr6LegacyInventoryListsOldResourcesWithoutDeleting` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR6 | Docs | `05_RUNBOOK.md` | `fr6LegacyCleanupRequiresManualConfirmation` | Runbook review: dry-run, explicit confirmation and evidence steps present |
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
| 1 | external reviewer | B1 post ordering could still no-op after `cleanWs()`; B2 `down -v` contradicted shared-volume protection; B3 scheduled GC daemon/selectors were not deterministic or positive; B4 plan was stale relative to #140. Should-fix: FR2/FR1 traceability, sandbox/proxy images outside Compose teardown, existing sandbox label, missing runbook, Jenkins job provisioning, D1 follow-up, pending decisions and test-name IDs. | This revision: FR1 now fixes ordering explicitly and adds a smoke hook; FR4/decision 4 define the validated build-scoped volume policy and explicit local-dev deny; FR3/FR5/decision 5 use positive labels and a pinned scheduled host/daemon ID; D4 records #140 as merged; every should-fix item is mapped above. | pending |
| 2 | external reviewer | Existing pre-label backlog was invisible to the labelled GC; post cleanup could select a different daemon than the build; main-pipeline pinning was a capacity/availability change; no `:ci` alias protection test; the CI-label anchor was ambiguous for pulled services; FR2 said Compose images have a `:ci` alias. | This revision adds FR6, the runbook legacy inventory/cleanup procedure and read-only `--legacy-inventory`; sets explicit-daemon mode for all Jenkins Docker stages and records the Integration Tests host/ID for post cleanup; keeps the main pipeline on its existing agents and pins only the scheduled job; adds the `:ci` alias test; uses the project network/volume as the authoritative anchor; corrects FR2. | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| pending | pending | pending | pending |
