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
     an old build ID, and Compose projects matching the strict pattern with the
     network/volume anchor. Running containers/networks/projects older than the
     grace period are hard-kill orphans and are removed; image removal fails
     safely if Docker still reports an image in use. It skips the shared `:ci`
     alias and the current build ID. The exact
     shared volume names (`postgres_data`, `uploads_data`, `vibecode_repos`)
     are refused regardless of labels.
   - `--legacy-inventory` is read-only. It lists pre-label candidates from old
     `vibecode-*` Compose projects, old build-unique tags and the existing
     sandbox label without requiring the new labels. Every image carrying a
     `:ci` tag is marked `shared/current — do not remove`; only build-unique old
     tags such as `vibecode-agent:<build>` are removal candidates. It marks
     `vibecoder-ai-planner` and the exact shared volumes as excluded and never
     issues a delete, prune or `compose down`.
   - `--dry-run`, `--docker-host`, `--daemon-id` and grace-period environment
     variables. Post mode is best-effort and exits 0; scheduled mode exits
     non-zero on any failure. — verify: `JenkinsDockerCleanupScriptTest`.

4. **Daemon compatibility gate and cleanup target** — extend
   `agent/scripts/sandbox-ci-env.sh` with
   `SANDBOX_CI_DOCKER_HOST_MODE=explicit` (default `auto` keeps today's
   local-socket preference). In explicit mode the helper requires the supplied
   `DOCKER_HOST`, only resolves the TCP hostname, and never falls back to
   `unix:///var/run/docker.sock`; an empty host is an error.

   Before changing pipeline daemon mode, run the real-Docker suite through the
   explicit host:
   `cd agent && DOCKER_HOST="$CI_DOCKER_HOST"
   SANDBOX_CI_DOCKER_HOST_MODE=explicit SANDBOX_IT_BUILD=1
   SANDBOX_IT_NETWORK=1 bash scripts/sandbox-integration-test.sh`.
   The script builds the sandbox/proxy images and runs
   `DockerSandboxRunnerIntegrationTest`. Record the result. If it passes and
   exec/cp/pause/top/run/network are permitted, set explicit mode for the Agent,
   Sandbox, Supply Chain and Integration Tests stages. The Cypress stage keeps
   its current `DOCKER_HOST` selection and stage-level `post { always }`
   teardown in both variants. If the gate fails because the proxy is
   restricted, keep those four stages on the existing helper/local-socket
   selection, make the Integration Tests stage use that same selection for its
   Compose project, and use explicit mode only for cleanup. If the proxy is
   restricted and there is no local socket, stop and record the sandbox suite as
   blocked; do not force explicit mode.

   In both cases, capture the actual host and `docker info --format '{{.ID}}'`
   for the Integration Tests project with `sh(returnStdout: true)` into Jenkins
   pipeline variables (`CI_DOCKER_HOST`, `CI_DOCKER_DAEMON_ID`) immediately
   before creating the Compose project. Do not write or read
   `target/ci-docker-daemon.env`; a workspace file is not authoritative. In
   `post { always }`, use the pipeline variables, set explicit mode, verify the
   daemon ID and only then call the cleanup script. If the variables are
   missing, use the explicit Jenkins `DOCKER_HOST` and compute the ID only in
   the explicit-all-stages variant; in the local-socket variant, log a warning
   and skip. Never guess a daemon or fall back to an uncaptured local socket;
   if the local-socket variant selected it, use the captured socket explicitly.
   The scheduled cleanup uses the same explicit mode with its own
   `CI_DOCKER_HOST`/`CI_DOCKER_DAEMON_ID` and aborts before listing or deleting
   anything on a mismatch. — verify: `SandboxCiEnvScriptTest`,
   `JenkinsDockerCleanupScriptTest`, `JenkinsfileCiCleanupTest` and the
   pre-implementation `DockerSandboxRunnerIntegrationTest` run.

5. **Scheduled maintenance job** — add `Jenkinsfile.cleanup` with
   `agent { label 'vibecode-ci-docker' }`, a six-hour cron trigger and
   parameters for `DRY_RUN`, `CI_DOCKER_HOST`, `CI_DOCKER_DAEMON_ID` and the
   grace periods. The job defaults to `DRY_RUN=true`; destructive cleanup also
   requires `ENABLE_DESTRUCTIVE_CLEANUP=true`. The cron definition is only
   active after an administrator provisions the Jenkins job. — verify:
   `JenkinsfileCiCleanupTest` plus the runbook procedure.

6. **Guard rails** — no broad prune, no name-prefix-only filters, no shared
   volume removal, no current build and no resource younger than the grace
   period. Running resources older than the grace period are hard-kill orphans
   and are removed. The project network/volume CI label is the authoritative
   anchor; pulled services do not need a build label. The local-dev project is
   an explicit deny. Pre-label resources are never removed by the automatic
   path; only the manual legacy inventory/cleanup procedure (FR6) may handle
   them. — verify:
   negative assertions in `JenkinsDockerCleanupScriptTest`.

7. **Documentation, runbook and index** — document the two-layer model, the
   provisioning prerequisite, retention values, manual dry-run and rollback in
   `05_RUNBOOK.md`. Add the one-time legacy backlog procedure: read-only
   inventory without new-label filters, candidate classification, dry-run
   command list, explicit confirmation and evidence record. The procedure marks
   every shared `:ci` image as current and never removes it; only build-unique
   old tags are candidates. Inventory volumes with `docker volume ls` plus
   `docker volume inspect` for creation dates. Run legacy `compose down` from
   the repo root with the compose files. Update `README.md`, `AGENTS.md` and the
   `PENDING.txt` row. — verify: `node planning/check-planning.js`, a
   runbook-defaults check and the FR6 documentation test.

## Pre-implementation daemon gate

Run this **before** changing any Docker stage's daemon mode:

```bash
cd agent
DOCKER_HOST="$CI_DOCKER_HOST" \
SANDBOX_CI_DOCKER_HOST_MODE=explicit \
SANDBOX_IT_BUILD=1 \
SANDBOX_IT_NETWORK=1 \
bash scripts/sandbox-integration-test.sh
```

Record the result in `03` Results. The script builds the sandbox/proxy images
and runs `DockerSandboxRunnerIntegrationTest` with the network suite enabled.
Replace `$CI_DOCKER_HOST` with the explicit host under test.

- **Pass** — the explicit `DOCKER_HOST` supports exec/cp/pause/top/run/network:
  use explicit mode for the Agent, Sandbox, Supply Chain and Integration Tests
  stages. The Cypress stage keeps its current `DOCKER_HOST` and stage-level
  cleanup.
- **Fail because the proxy is restricted** — keep the Agent, Sandbox, Supply
  Chain and Integration Tests stages on the existing helper/local-socket
  selection, make the Integration Tests stage use that same selection, and use
  explicit mode only for post/scheduled cleanup. The Cypress stage keeps its
  current `DOCKER_HOST` and stage-level cleanup. If no local socket is available
  either, record the sandbox suite as blocked and do not force explicit mode.

In both cases, capture the daemon actually used by the Integration Tests stage
into Jenkins pipeline variables as described in step 4. Do not proceed with the
explicit-all-stages variant until this gate is green.

**Operational status: pending.** This planning workspace cannot reach the
Jenkins explicit daemon (`docker-socket-proxy` does not resolve here), so the
gate must be run on Jenkins against the real `DOCKER_HOST` before any
daemon-mode implementation change. Record `pass`, `local-socket fallback` or
`blocked` in `03` Results. If `local-socket fallback` is selected, also record
the existing local-socket `DockerSandboxRunnerIntegrationTest` result as the
validating run; the explicit-host result remains `local-socket fallback`.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `Jenkinsfile` | MODIFY | Teardown first in `post { always }`; `cleanWs()` in `post { cleanup }`; remove success-only cleanup; add `CI_SMOKE_FAIL`; apply the recorded daemon compatibility result; capture the Integration Tests host and daemon ID with `sh(returnStdout: true)` into pipeline variables (never a workspace file); use explicit mode for the Agent/Sandbox/Supply Chain/Integration Tests stages only if the gate passes, otherwise only for cleanup; keep the Cypress stage on its current `DOCKER_HOST` and stage-level cleanup; add CI labels/tags; call the cleanup script for the current project and current build images. Do not change the main pipeline's agent label. |
| `Jenkinsfile.cleanup` | CREATE | Scheduled orphan-GC pipeline with dedicated node label, cron, `DRY_RUN`, explicit host/daemon ID and grace-period parameters. |
| `agent/scripts/jenkins-docker-cleanup.sh` | CREATE | Scoped teardown/build-image removal, label/age-scoped orphan GC and read-only `--legacy-inventory`; dry-run and daemon verification. |
| `agent/scripts/sandbox-ci-env.sh` | MODIFY | Add explicit-daemon mode that never substitutes the local socket. |
| `agent/scripts/sandbox-integration-test.sh` | MODIFY | Add CI labels and build-unique tags to the sandbox/proxy builds. |
| `docker-compose.yml` | MODIFY | Add `build.labels` to `migrate`, `api`, `frontend`; label `default` network and the three volumes with the CI metadata. |
| `docker-compose.test.yml` | MODIFY | Add `build.labels` to the `test` image. |
| `docker-compose.e2e.yml` | MODIFY | Add `build.labels` to the `cypress` image. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsDockerCleanupScriptTest.java` | CREATE | Fake-Docker coverage for compose teardown, build-image removal, orphan filters, `:ci` alias protection, dry-run, grace periods, daemon checks, workspace-override rejection, volume protection and legacy inventory. |
| `agent/src/test/java/com/vibecode/agent/harness/JenkinsfileCiCleanupTest.java` | CREATE | Static assertions for post ordering, `cleanWs()` placement, pipeline daemon variables (no workspace file), daemon gate, labels, smoke hook and scheduled-job wiring. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxIntegrationScriptTest.java` | MODIFY | Assert the CI labels and build-unique tags are passed. |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxCiEnvScriptTest.java` | MODIFY | Cover `SANDBOX_CI_DOCKER_HOST_MODE=explicit`. |
| `planning/bp-135-ci-docker-resource-cleanup/05_RUNBOOK.md` | CREATE | Provisioning, retention defaults, dry-run, inspect, daemon compatibility, legacy backlog procedure with shared-`:ci` protection, recovery and rollback. |
| `AGENTS.md`, `README.md` | MODIFY | Document the cleanup job, retention env vars, dedicated node and the no-broad-prune rule. |
| `PENDING.txt` | MODIFY | Keep the `bp-135` row and label aligned with this suite. |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Static | `JenkinsfileCiCleanupTest` | `fr1TeardownRunsBeforeCleanWsInPostAlways` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR1 | Static | `JenkinsfileCiCleanupTest` | `fr1CleanWsRunsInPostCleanup` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR1 | Script | `JenkinsDockerCleanupScriptTest` | `fr1ComposeProjectTeardownIsScopedAndUsesTheValidatedName` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR1 | Smoke | Jenkins smoke build | `fr1FailedSmokeBuildLeavesNoComposeProject` (record in `03` Results) | `CI_SMOKE_FAIL=1` build, then `docker ps -a`, `docker network ls`, `docker volume ls` and `docker images` filtered by the build project |
| FR2 | Script | `SandboxIntegrationScriptTest` | `fr2SandboxAndProxyBuildsCarryCiLabelsAndBuildTag` | `mvn -Dtest=SandboxIntegrationScriptTest test` |
| FR2 | Static | `JenkinsfileCiCleanupTest` | `fr2SupervisorAndComposeBuildsCarryCiLabels` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR2 | Script | `JenkinsDockerCleanupScriptTest` | `fr2BuildImageRemovalKeepsTheSharedCiAlias` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR2 | Script | `JenkinsDockerCleanupScriptTest` | `fr2BuildImageRemovalRemovesUntaggedImageId` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphanSandboxContainersAreAgeCheckedAndDryRunIsReadOnly` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphanGcKeepsSharedCiAlias` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphanSandboxNetworksRemoveOldAttachedNetworks` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphanComposeProjectsRemoveOldRunningProjects` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR3 | Script | `JenkinsDockerCleanupScriptTest` | `fr3OrphanCiImagesRemoveDanglingImages` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR4 | Script | `JenkinsDockerCleanupScriptTest` | `fr4RefusesTheLocalDevProjectAndUnrecognizedNames` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR4 | Script | `JenkinsDockerCleanupScriptTest` | `fr4DryRunDoesNotTearDownOrRemoveAnything` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Manual | `DockerSandboxRunnerIntegrationTest` | `fr5ExplicitDaemonRunsRealDockerSuite` | `cd agent && DOCKER_HOST="$CI_DOCKER_HOST" SANDBOX_CI_DOCKER_HOST_MODE=explicit SANDBOX_IT_BUILD=1 SANDBOX_IT_NETWORK=1 bash scripts/sandbox-integration-test.sh` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5DaemonMismatchFailsBeforeDeletion` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5PostCleanupUsesPipelineDaemon` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Script | `JenkinsDockerCleanupScriptTest` | `fr5PostCleanupFallsBackToExplicitHost` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR5 | Static | `JenkinsfileCiCleanupTest` | `fr5ScheduledJobPinsNodeAndDaemon` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR5 | Static | `JenkinsfileCiCleanupTest` | `fr5PostCleanupUsesPipelineDaemonVariable` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR5 | Static | `JenkinsfileCiCleanupTest` | `fr5CypressTeardownRemovesImages` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| FR6 | Script | `JenkinsDockerCleanupScriptTest` | `fr6LegacyInventoryIsReadOnlyAndProtectsSharedAliases` (asserts `:ci` images are shared/current and excluded) | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| FR6 | Docs | `05_RUNBOOK.md` | `fr6LegacyCleanupRequiresManualConfirmation` | Runbook review: dry-run, explicit confirmation and evidence steps present |
| NFR1 | Script | `JenkinsDockerCleanupScriptTest` | `nfr1MissingAnchorIsANoOp` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR1 | Static | `JenkinsfileCiCleanupTest` | `nfr1ScheduledCleanupDefaultsToDryRun` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |
| NFR2 | Script | `JenkinsDockerCleanupScriptTest` | `nfr2GraceAndBuildIdSkipCurrentResources` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR3 | Script | `JenkinsDockerCleanupScriptTest` | `nfr3FakeDockerCoversAllCleanupPaths` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR4 | Script | `JenkinsDockerCleanupScriptTest` | `nfr4RetentionValuesComeFromEnvironment` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR4 | Docs | `05_RUNBOOK.md` | `nfr4RunbookDocumentsTheSameDefaults` | `grep` the defaults in `05_RUNBOOK.md` and `README.md` |
| NFR5 | Script | `JenkinsDockerCleanupScriptTest` | `nfr5WorkspaceDaemonFileCannotRedirectCleanup` | `mvn -Dtest=JenkinsDockerCleanupScriptTest test` |
| NFR5 | Static | `JenkinsfileCiCleanupTest` | `nfr5NoWorkspaceDaemonFileIsTrusted` | `mvn -Dtest=JenkinsfileCiCleanupTest test` |

## Verification commands

```bash
node planning/check-planning.js
cd agent && mvn -Dtest=JenkinsDockerCleanupScriptTest,JenkinsfileCiCleanupTest,SandboxIntegrationScriptTest,SandboxCiEnvScriptTest test
cd agent && DOCKER_HOST="$CI_DOCKER_HOST" SANDBOX_CI_DOCKER_HOST_MODE=explicit SANDBOX_IT_BUILD=1 SANDBOX_IT_NETWORK=1 bash scripts/sandbox-integration-test.sh
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
| 3 | external reviewer | Legacy cleanup could remove the current shared `:ci` aliases; the volume inventory used an unsupported `CreatedAt` formatter field; forcing explicit mode for all stages could break the real-Docker sandbox suite; the workspace daemon record could redirect cleanup; legacy compose command depended on the operator's cwd; image inventory omitted size. | This revision marks every `:ci` image shared/current and limits legacy removal to build-unique old tags; fixes volume/image inventory commands and the repo-root compose command; adds the explicit-daemon compatibility gate and keeps build/test on the local socket when the proxy is restricted; moves the cleanup target to Jenkins pipeline variables and adds NFR5; adds FR5/FR6/NFR5 coverage. | pending |
| 4 | external reviewer | Local-socket wording could be read as forbidding the captured local socket; the Jenkinsfile was described as running the manual gate; the gate command path was inconsistent; the Cypress stage's daemon choice was unspecified in the fallback. | This revision distinguishes the captured local socket from an uncaptured fallback, says the pipeline applies the recorded gate result, makes the gate command run from `agent`, and documents Cypress as keeping its current `DOCKER_HOST` plus stage-level cleanup. The gate itself is recorded as a pending operational prerequisite. | pending |
| 5 | external reviewer | FR5 gate remains the only operational prerequisite; if the local-socket fallback is selected, the existing local-socket suite result must be recorded as the validating run. | FR5 status, decision 7, the operational gate section and the runbook now require that evidence; the gate remains pending on Jenkins. | pending |
| 6 | external reviewer | Old CI images became dangling after the `:ci` alias moved and were never removed; running hard-kill resources were skipped; the scheduled job defaulted to destructive; legacy volume/dangling inventory was incomplete; Cypress images were not removed; matrix/test coverage was incomplete. | This revision removes image IDs when no `:ci` alias remains, treats old running resources as orphans, defaults the scheduled job to dry-run with an explicit destructive-enable flag, restricts legacy volume candidates and lists dangling images, adds `--rmi local` to the Cypress teardown, and adds the missing regression rows. | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-12 | d51aaca | `cd agent && mvn test` (496 tests, 5 skipped) + `SANDBOX_IT_BUILD=0 SANDBOX_IT_NETWORK=1 SANDBOX_IT_IMAGE=vibecode-agent-sandbox:ci SANDBOX_IT_PROXY_IMAGE=vibecode-sandbox-proxy:ci bash scripts/sandbox-integration-test.sh` (5 tests, 0 skipped) + `mvn package -q -DskipTests` + `node planning/check-planning.js` + `docker compose ... config -q` + `bash -n` | Partial: local-socket variant implemented (post teardown, CI labels/tags, cleanup script and tests, scheduled cleanup pipeline, runbook). The real-Docker suite still passes. FR5 explicit-daemon gate, Jenkins smoke evidence and the one-time legacy cleanup remain pending. |
