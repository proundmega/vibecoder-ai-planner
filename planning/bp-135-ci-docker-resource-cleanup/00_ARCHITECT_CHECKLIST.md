---
id: "bp-135"
title: "Clean up Docker resources left by failed Jenkins runs"
status: in_progress
priority: "P1"
effort: "Medium"
scope: "Infra"
created: "2026-11-12"
updated: "2026-11-13"
pr: 142
branch: "feat/bp-135-ci-docker-cleanup"
depends_on: []
---

# 00 — Clean up Docker resources left by failed Jenkins runs (bp-135)

> Lightweight suite: a CI/infra-only change with no API, database, auth,
> migration or agent-boundary change.

## Why this ticket exists

Each Jenkins build runs its Compose stack under a build-unique project name
(`vibecode-<branch>-ci-<job>-<hash>-<build>`) and builds three shared-tag CI images. Failed or
aborted builds can leave that project's containers, network, volumes and images
behind. The problem is not only the failure path: the current top-level cleanup
is in `post { success { ... } }`, but Jenkins runs `post { always { cleanWs() } }`
first (the documented order is `always` → … → `success` → `cleanup`).
`cleanWs()` deletes the workspace, including the Compose files, so the success
cleanup cannot run and its `catch` hides the failure. The Cypress stage has its
own stage-level `post { always { ... down -v ... } }`; the gap is the top-level
integration stack and the CI images built outside that project.

The fix has two layers: every build tears down its own project in
`post { always }` before `cleanWs()` moves to `post { cleanup }`, and a
scheduled maintenance job removes resources that survive a killed agent,
daemon restart or Jenkins crash.

## Requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Every pipeline run tears down its own Compose project in `post { always }` before the workspace is deleted, including success, failure and abort paths. `cleanWs()` moves to `post { cleanup }` (the last post condition). Teardown only runs for a validated CI project. | A static test asserts the teardown is in `post { always }` before `cleanWs()` and that `cleanWs()` is under `post { cleanup }`. A successful control build and a build with `CI_SMOKE_FAIL=1` both log the teardown before workspace deletion and leave no containers, network, volumes or Compose-built images with `com.docker.compose.project=$COMPOSE_PROJECT_NAME`. |
| FR2 | CI-built images are labelled with `com.vibecode.ci=true`, `com.vibecode.ci.job` and `com.vibecode.ci.build`. The supervisor (`vibecode-agent`), sandbox and proxy carry a build-unique tag in addition to the shared `:ci` alias; Compose-built images are unique by project name and do not have a `:ci` alias. | `docker image inspect` shows the labels on all four groups from a smoke build; static tests assert `--label`/`build.labels` in the Jenkinsfile, the sandbox script and the Compose files. The shared `:ci` tag is never removed by any automatic or manual cleanup. |
| FR3 | A scheduled, job-agnostic Jenkins maintenance job removes orphaned CI resources using positive selectors and age: sandbox containers/networks with `vibecode.sandbox.managed=true`; CI images with `com.vibecode.ci=true` and an old build identifier, excluding any image still referenced by the shared `:ci` alias; and old Compose projects (including running hard-kill orphans) that match the strict CI name pattern and carry the CI label on their project network or a named volume. | A fake-Docker fixture with old labelled resources is removed; current resources, unlabelled resources, the local-dev project and an old image still carrying the shared `:ci` alias are left untouched; `--dry-run` changes nothing. |
| FR4 | The automatic cleanup path is scoped and safe. No `docker system prune -a` and no name-prefix-only selection. A validated build-scoped project may be removed with `down -v`; the local-dev project `vibecoder-ai-planner` and its `postgres_data`, `uploads_data` and `vibecode_repos` volumes are explicitly refused. The exact shared volume names `postgres_data`, `uploads_data` and `vibecode_repos` are refused regardless of labels. The project network/volume CI label is the authoritative anchor; pulled services such as redis, postgres and docker-proxy do not need a build label. Resources outside a validated CI project or without the positive CI label are never removed by the automatic path. The one-time manual legacy procedure (FR6) is the only exception. | Script tests assert the exact Docker filters, that the network/volume anchor and project-name regex are checked before `down -v`, that `vibecoder-ai-planner` and the exact shared volume names are refused, and that no `docker system prune` or `docker volume rm` of the exact shared names is issued. |
| FR5 | Cleanup uses the exact daemon that owns the build's Compose project. A pre-implementation gate runs the real-Docker sandbox suite through the explicit `DOCKER_HOST`; if it passes (exec, cp, pause, top, run and network operations permitted), the Agent, Sandbox, Supply Chain and Integration Tests stages use explicit mode with that host. The Cypress stage keeps its current `DOCKER_HOST` selection and stage-level `post { always }` teardown in both variants. If the proxy is restricted, those four stages keep the existing helper/local-socket selection (including the Integration Tests Compose project) and only cleanup uses explicit mode. In both cases the Integration Tests stage captures the actual host and daemon ID with `sh(returnStdout: true)` into Jenkins pipeline variables; `post { always }` uses them, verifies the ID and never falls back to an uncaptured local socket. If the variables are missing, it uses the explicit Jenkins `DOCKER_HOST` only in the explicit-all-stages variant; in the local-socket variant it warns and skips. The scheduled job is pinned to one dedicated node and takes explicit `CI_DOCKER_HOST` and `CI_DOCKER_DAEMON_ID`; it aborts before any deletion on a missing host or mismatched ID. | The pre-implementation `DockerSandboxRunnerIntegrationTest` result is recorded in `03` Results with the explicit host and network suite. A fake-Docker test covers pipeline-variable host/ID, the explicit `DOCKER_HOST` fallback and a mismatch; a static test asserts the Jenkinsfile captures the host/ID with `sh(returnStdout: true)`, and that `Jenkinsfile.cleanup` pins the node and passes the explicit host/ID. The smoke build records the same daemon ID at build and cleanup time. |
| FR6 | Resources created before the new labels and tags are handled by a one-time manual legacy inventory/cleanup, not by the scheduled GC. The normal GC only selects positively labelled resources; the legacy procedure is the explicit exception. It is read-only inventory first, dry-run, explicit confirmation, and scoped to old `vibecode-*` projects and build-unique old tags while refusing the local-dev project, shared volumes and any image carrying a shared `:ci` alias. | `05_RUNBOOK.md` contains the no-new-label inventory commands, candidate classification, dry-run command list, confirmation step and evidence record. `agent/scripts/jenkins-docker-cleanup.sh --legacy-inventory` lists old candidates without deleting anything and marks every `:ci` image as shared/current. A fake-Docker test asserts no remove/prune command is issued and that `:ci` images, `vibecoder-ai-planner` and the exact shared volume names are excluded. The one-time cleanup is recorded in `03` Results. |
| NFR1 | Cleanup is idempotent and non-fatal for the build: missing resources are ignored, and a failed `post` cleanup warns without changing a successful build result. The scheduled job reports failures with a non-zero exit. | Re-running cleanup exits 0; a simulated `docker` failure leaves the build result unchanged in post mode; the scheduled mode exits non-zero. |
| NFR2 | Cleanup cannot race a concurrent build. The grace period is longer than the 60-minute pipeline timeout, and selection is keyed to the job and build-ID labels and active container references, not only the image `Created` timestamp. Post cleanup is scoped to `com.vibecode.ci.job` plus `com.vibecode.ci.build`; the scheduled GC is job-agnostic. | A resource younger than the grace period is never selected; the optional `CI_CURRENT_BUILD_ID` guard, when supplied, also skips that build ID; two concurrent builds have distinct labels and project names, including across two Jenkins jobs that share a build number; the project name uses a 32-bit name hash to break sanitization collisions, so the guarantee is collision-resistant rather than mathematical. The grace period is the primary protection because no pipeline sets `CI_CURRENT_BUILD_ID`. |
| NFR3 | The cleanup script has deterministic regression coverage with a fake `docker` binary, and the Jenkinsfile post ordering has a static regression test. | `JenkinsDockerCleanupScriptTest` covers both modes, dry-run, filters, grace periods, daemon checks, workspace-override rejection, volume protection and legacy inventory; `JenkinsfileCiCleanupTest` covers post ordering, pipeline daemon variables and label wiring. |
| NFR4 | Retention values are configurable and documented. | `CI_IMAGE_GRACE_HOURS` (default 24), `CI_CONTAINER_GRACE_HOURS` (default 2) and `CI_BUILD_GRACE_HOURS` (default 6) are read from the environment and documented in `05_RUNBOOK.md`, `README.md` and `AGENTS.md`. |
| NFR5 | The cleanup target cannot be selected from the workspace. Daemon host/ID come from Jenkins pipeline variables captured by trusted `sh(returnStdout: true)` steps, not from a workspace-writable file. | A static test asserts post cleanup uses the pipeline variables and does not read `target/ci-docker-daemon.env`; a fake-Docker test writes a hostile workspace file and asserts the cleanup target is unchanged. |

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence |
|---|---|---|---|
| A1 | CI resources are distinguishable by a strict project-name pattern and positive labels on images plus the project network/volumes; build project names include the Jenkins job and build number, because build numbers are unique only within a job. | Cleanup could remove another job's resources on a shared daemon. | `Jenkinsfile` sets `COMPOSE_PROJECT_NAME` from `BRANCH_NAME`, a sanitized `JOB_NAME` and `BUILD_NUMBER`; post cleanup filters images by `com.vibecode.ci.job` plus `com.vibecode.ci.build` and checks the same labels on the project anchor. |
| A2 | `post { always }` runs on ordinary test failures and user aborts; `post { cleanup }` runs last. Hard agent/daemon failures leave cleanup to the scheduled job. | A hard-killed build leaves resources until the next maintenance run. | Jenkins post-condition ordering; scheduled job is the safety net. |
| A3 | Per-build Compose images and build-scoped volumes are disposable; BuildKit layer cache remains. The Cypress stage already uses `down -v` for the same build project. | Removing build-scoped volumes would discard reusable data. | Cypress stage already removes them; only tagged project resources are removed, not the builder cache. |
| A4 | The scheduled job can run from the repository with Docker access on a dedicated node. Creating the Jenkins job from `Jenkinsfile.cleanup` is a rollout prerequisite; adding the file alone does not schedule anything. The main pipeline stays on its existing agents; only the scheduled job needs the dedicated label. | The safety net would not exist until an administrator provisions the job. | Runbook step; Jenkins job configuration. |
| A5 | The local-dev stack is a separate project (`vibecoder-ai-planner`) and must never be selected. | `down -v` could delete local development data. | Strict `^vibecode-[a-z0-9][a-z0-9-]*-[0-9]+$` check plus explicit deny; negative tests. |
| A6 | Builds may run on more than one agent/daemon. Post cleanup follows the pipeline-captured build daemon, so it remains correct; the scheduled job covers only its pinned host, so each additional host needs its own maintenance job for hard-kill coverage. | A single maintenance job would leave the other hosts' hard-kill orphans until they are inventoried. | Pipeline-captured host/ID for post cleanup; explicit host/ID per scheduled job; multi-host fan-out deferred (D5). |
| A7 | The explicit `DOCKER_HOST` may not permit the real-Docker sandbox operations (exec, cp, pause, top, run, network). | Forcing explicit mode would break the D13/D14 suite even though Compose works. If neither the proxy nor a local socket permits the suite, the suite is blocked in that Jenkins configuration. | Pre-implementation gate: run `DockerSandboxRunnerIntegrationTest` with the explicit host and network suite; if it fails, keep build/test on the local socket and use explicit mode only for cleanup. Record in `03` Results. |

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| Jenkinsfile | Fixes post ordering, applies the recorded daemon compatibility result, captures the selected build daemon host/ID into pipeline variables, adds CI labels, a `CI_SMOKE_FAIL` hook and the cleanup call. The main pipeline keeps its existing agent assignment; only the scheduled job is pinned. | this ticket |
| `Jenkinsfile.cleanup` | Defines the scheduled maintenance pipeline; the Jenkins job itself is provisioned separately. | this ticket |
| Compose files | Adds `build.labels` and CI metadata so build resources are discoverable; local-dev resources default to `com.vibecode.ci=false` with empty job/build and are not classified as CI. | this ticket |
| CI helper/scripts | Adds explicit-daemon mode to the helper and a scoped cleanup script. | this ticket |
| API, DB, frontend, agent boundary | n/a — CI/infra only. | n/a |
| Rollback | Disable the scheduled job and revert the Jenkinsfile/script/compose changes; labels are inert. | git revert |

## Readiness gate (before implementation)

- [x] Scope is one layer and the root cause is understood
- [x] Every requirement above has a testable acceptance statement
- [x] Assumptions are listed with a validation path
- [x] The verification command/test is identified
- [x] No API, database, auth, migration or agent-boundary change is involved

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan authored | PR #141, rebased onto `02ffc0a` | ☑ |
| Plan review round 1 | Blocking findings B1-B4 addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 2 | Pre-label backlog and post-cleanup daemon findings addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 3 | Legacy `:ci` protection, volume inventory, explicit-daemon compatibility gate and workspace-trust findings addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 4 | Local-socket wording, gate ownership/path, Cypress daemon variant and gate status clarified; re-review pending (`03` Review record) | ☑ |
| Plan review round 5 | FR5 gate fallback evidence requirement recorded; re-review pending (`03` Review record) | ☑ |
| Plan review round 6 | Dangling images, hard-kill running resources, safe scheduled defaults, legacy inventory, Cypress images and test coverage addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 7 | Job-scoped post cleanup, build-tag-only removal, non-zero orphan failures, fail-closed `:ci` inspect and runbook consistency addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 8 | Job-slug collisions, optional current-build claim, stderr parsing, race classification, build-ID requirement and volume-only/negative-anchor coverage addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 9 | Project-pattern hash examples, collision-resistance wording, compose stderr classification and older-daemon volume note addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 10 | Compose logrus warning stripping and network `<no value>` fallback addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 11 | Jenkins pipeline environment leakage in tests and BusyBox timestamp parsing fixed; re-review pending (`03` Review record) | ☑ |
| Plan review round 12 | Fail-closed age parsing, non-UTC T handling and RFC3339/offset coverage addressed; re-review pending (`03` Review record) | ☑ |
| Plan review round 13 | Bare zone abbreviation without an offset now fails closed; re-review pending (`03` Review record) | ☑ |
| FR5 daemon gate | `local-socket fallback` validated by Jenkins PR-142 build #3 (`continuous-integration/jenkins/pr-head` pass, 2026-11-13); the real-Docker sandbox suite ran on the helper-selected local socket. Explicit-all-stages variant remains deferred; `03` Results records the run | ☑ |
| D13 helper available | PR #140 merged at `02ffc0a`; `agent/scripts/sandbox-ci-env.sh` is on master | ☑ |
| Plan merged | PR #141, merge `7867a41` | ☑ |
| Jenkins PR check | PR-142 build #3, `continuous-integration/jenkins/pr-head` pass; full pipeline including the real-Docker sandbox suite | ☑ |
| Jenkins smoke build | PR-142 build #4 with `CI_SMOKE_FAIL=true` (expected failure): teardown removed the build project, volumes, Compose images and build tags; shared `:ci` aliases kept; `cleanWs()` followed | ☑ |
| Scheduled cleanup job | Created from the feature branch and run manually on the built-in node labeled `vibecode-ci-docker`; dry run listed four dangling old CI images, destructive run removed them, and both shared `:ci` aliases were kept. Switch SCM to `master` after merge. | ☑ |
| Implementation started | `feat/bp-135-ci-docker-cleanup`, PR #142; local-socket variant first; unit tests and planning check pass | ☑ |
| Implementation completed | PR #142 head `f354846`; 521 unit tests pass locally; Jenkins PR-142 build #3 passes; reports now include the collision-resistant job slug, fail-closed age parsing and operationally safe cleanup | ☑ |
| Verification results | `03` Results: local `mvn test` (521, 5 skipped), real-Docker sandbox suite (5, 0 skipped), package/planning/compose/shell checks, and Jenkins PR-142 build #3 | ☑ |
| Legacy backlog cleanup | Manual legacy procedure removed `vibecode-pr-118-3` and `vibecode-pr-117-1` (10 containers, 2 networks, 6 volumes, 9 images); follow-up dry-run returned no resources. Local dev, Jenkins, proxy and buildkit untouched. | ☑ |

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Host cron/systemd timer for when Jenkins itself is down and cannot run the scheduled maintenance job. | self | Operability | new infra ticket | open |
| D2 | BuildKit cache pruning beyond labelled images; this ticket removes images, containers, networks and build-scoped volumes but not the builder cache. | self | Capacity | follow-up | open |
| D3 | Environment-specific retention tuning beyond the documented defaults. | self | Operability | none | open |
| D4 | Reuse the D13 helper (`agent/scripts/sandbox-ci-env.sh`). | fg-34 D13 | Dependency | none | resolved (PR #140, `02ffc0a`) |
| D5 | Automatic fan-out to every Docker daemon. The first version pins one maintenance job to one host and requires one job per host for multi-daemon deployments. | self | Operability | new infra ticket | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Where should cleanup run? | A: pipeline only; B: scheduled Jenkins job only; C: both | C — `post { always }` for build-scoped teardown, plus a scheduled label/age GC for crashes and hard kills | C — accepted 2026-11-12 |
| 2 | Default image/container grace periods? | A: 24h images / 2h containers / 6h build IDs; B: 48h / 6h / 24h; C: other | A — longer than the 60-minute pipeline timeout, short enough to bound disk | A — accepted 2026-11-12 |
| 3 | Remove per-build Compose images on every run? | A: yes, `--rmi local`; B: only on failure | A — build cache remains and disk stays bounded | A — accepted 2026-11-12 |
| 4 | Volume policy for the validated build project? | A: `down -v` for the validated build-scoped project, refuse local-dev/external volumes by positive selector; B: never `-v`, add a separate volume GC | A — build-scoped volumes are already disposable (the Cypress stage uses `-v`); the local-dev project is explicitly refused | A — accepted 2026-11-12 |
| 5 | Daemon selection for the scheduled job? | A: one dedicated node + explicit host/daemon ID; B: iterate all Docker hosts | A — deterministic and safe; multi-host fan-out is D5 | A — accepted 2026-11-12 |
| 6 | What about resources created before the new labels/tags? | A: one-time manual inventory/cleanup procedure in this ticket (read-only inventory, dry-run, explicit confirmation); B: defer the existing backlog | A — the new GC cannot see the old backlog, and leaving it in place would not fix the problem that motivated the ticket | A — accepted 2026-11-12 |
| 7 | What if the explicit `DOCKER_HOST` cannot run the real-Docker sandbox suite? | A: keep build/test stages on the local socket and use explicit mode only for cleanup; B: force explicit mode and accept a broken suite | A — the pre-implementation gate decides; if fallback is selected, record the existing local-socket suite result as the validating run | A — local-socket fallback validated on Jenkins PR-142 build #3; explicit-all-stages variant deferred |

## Completion gate

- [ ] Every requirement is met
- [ ] `03` Results has a dated, non-placeholder row
- [ ] Tests carry the requirement ID and there are no non-waived `missing`/`partial` gaps
- [ ] `status` is `done` only after the implementation PR is merged and `pr` is set
- [ ] `PENDING.txt` label matches this file
- [ ] Review record in `03` shows blocking findings resolved
- [ ] Deferred register reflects what was actually left out

## Notes

The scheduled job is intentionally a **Jenkins job**, not host cron, so it uses
the same repository script and log retention as the pipeline. A host timer can
be added later for the case where Jenkins itself is down (D1). The pipeline
cleanup is the primary fix; the scheduled job is the safety net.

Creating the `vibecode-ci-docker-cleanup` Jenkins job from
`Jenkinsfile.cleanup`, with its cron trigger, is a rollout prerequisite. Adding
the file alone does not schedule anything.

The current top-level `post { success { ... } }` cleanup is effectively dead:
`post { always { cleanWs() } }` runs first and removes the Compose files. The
implementation must move the teardown to `post { always }` **before** deleting
the workspace, and move `cleanWs()` to `post { cleanup }`. Do not simply change
the condition from `success` to `always` and leave `cleanWs()` first.

Build-scoped volumes such as
`vibecode-<branch>-ci-<job>-<hash>-<build>_postgres_data` are disposable copies. They are
removed by the validated project teardown. The local-dev volumes
`vibecoder-ai-planner_{postgres_data,uploads_data,vibecode_repos}` are not
build-scoped and must never be selected.

The automatic GC cannot see resources created before the new labels and tags.
Those are handled once by the manual procedure in `05_RUNBOOK.md` (FR6), not by
the scheduled job. The procedure starts read-only, uses a dry run and requires
an explicit confirmation before any removal. It never removes a shared `:ci`
alias; only build-unique old tags are candidates.

The main pipeline is **not** pinned to the `vibecode-ci-docker` label; post
cleanup follows the pipeline-captured daemon selected by the Integration Tests
stage. Only the scheduled maintenance job uses the dedicated label so its host
is deterministic.

The cleanup daemon host/ID must come from Jenkins pipeline variables captured by
trusted `sh(returnStdout: true)` steps, not from a file under the workspace. A
file at `target/ci-docker-daemon.env` is not authoritative and must never
redirect cleanup.

Before forcing explicit-daemon mode for the Agent, Sandbox, Supply Chain and
Integration Tests stages, run the real-Docker sandbox suite through the explicit
`DOCKER_HOST`. If the proxy cannot support exec/cp/pause/top/run/network, keep
those stages on the local socket and use explicit mode only for cleanup. The
Cypress stage keeps its current `DOCKER_HOST` and stage-level cleanup.
