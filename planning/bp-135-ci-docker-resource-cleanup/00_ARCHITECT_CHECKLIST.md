---
id: "bp-135"
title: "Clean up Docker resources left by failed Jenkins runs"
status: planned
priority: "P1"
effort: "Medium"
scope: "Infra"
created: "2026-11-12"
updated: "2026-11-12"
pr: null
branch: null
depends_on: []
---

# 00 — Clean up Docker resources left by failed Jenkins runs (bp-135)

> Lightweight suite: a CI/infra-only change with no API, database, auth,
> migration or agent-boundary change.

## Why this ticket exists

Each Jenkins build runs its Compose stack under a build-unique project name
(`vibecode-<branch>-<build>`) and builds three shared-tag CI images. Failed or
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
| FR2 | CI-built images are labelled with `com.vibecode.ci=true`, `com.vibecode.ci.job` and `com.vibecode.ci.build`, and carry a build-unique tag in addition to the shared `:ci` alias. This covers the supervisor (`vibecode-agent`), sandbox, proxy and Compose-built images. | `docker image inspect` shows the labels on all four groups from a smoke build; static tests assert `--label`/`build.labels` in the Jenkinsfile, the sandbox script and the Compose files. The shared `:ci` tag is never removed by the age-based GC. |
| FR3 | A scheduled Jenkins maintenance job removes orphaned CI resources using positive selectors and age: sandbox containers/networks with `vibecode.sandbox.managed=true`, CI images with `com.vibecode.ci=true` and an old build identifier, and stopped Compose projects matching the strict CI name pattern. | A fake-Docker fixture with old labelled resources is removed; current resources, unlabelled resources and the local-dev project are left untouched; `--dry-run` changes nothing. |
| FR4 | Cleanup is scoped and safe. No `docker system prune -a` and no name-prefix-only selection. A validated build-scoped project may be removed with `down -v`; the local-dev project `vibecoder-ai-planner` and its `postgres_data`, `uploads_data` and `vibecode_repos` volumes are explicitly refused. The exact shared volume names `postgres_data`, `uploads_data` and `vibecode_repos` are refused regardless of labels. Resources outside a validated CI project or without the positive CI label are never removed. | Script tests assert the exact Docker filters, that `down -v` runs only after the project-name regex and CI-label checks, that `vibecoder-ai-planner` is refused, and that no `docker system prune` or `docker volume rm` of the exact shared names is issued. |
| FR5 | Cleanup uses a deterministic daemon. The scheduled job is pinned to one dedicated Jenkins node and takes explicit `CI_DOCKER_HOST` and `CI_DOCKER_DAEMON_ID`; it verifies `docker info --format '{{.ID}}'` and aborts before any deletion on a missing host or mismatched ID. It never falls back to `unix:///var/run/docker.sock`. Post-build cleanup uses the same daemon as the build and verifies the ID when configured. | A fake-Docker test covers missing host, mismatched daemon and `--dry-run`; the dry run prints the host and daemon ID. A static test asserts `Jenkinsfile.cleanup` uses the dedicated node label and passes the explicit host/ID. |
| NFR1 | Cleanup is idempotent and non-fatal for the build: missing resources are ignored, and a failed `post` cleanup warns without changing a successful build result. The scheduled job reports failures with a non-zero exit. | Re-running cleanup exits 0; a simulated `docker` failure leaves the build result unchanged in post mode; the scheduled mode exits non-zero. |
| NFR2 | Cleanup cannot race a concurrent build. The grace period is longer than the 60-minute pipeline timeout, and selection is keyed to the build-ID label and active container references, not only the image `Created` timestamp. | A resource younger than the grace period is never selected; an image with an old `Created` timestamp but the current build ID is skipped; two concurrent builds have distinct labels and project names. |
| NFR3 | The cleanup script has deterministic regression coverage with a fake `docker` binary, and the Jenkinsfile post ordering has a static regression test. | `JenkinsDockerCleanupScriptTest` covers both modes, dry-run, filters, grace periods, daemon checks and volume protection; `JenkinsfileCiCleanupTest` covers post ordering and label wiring. |
| NFR4 | Retention values are configurable and documented. | `CI_IMAGE_GRACE_HOURS` (default 24), `CI_CONTAINER_GRACE_HOURS` (default 2) and `CI_BUILD_GRACE_HOURS` (default 6) are read from the environment and documented in `05_RUNBOOK.md`, `README.md` and `AGENTS.md`. |

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence |
|---|---|---|---|
| A1 | CI resources are distinguishable by a strict project-name pattern and positive labels; build project names include the Jenkins build number. | Cleanup could remove another build's resources. | `Jenkinsfile` sets `COMPOSE_PROJECT_NAME` from `BRANCH_NAME` and `BUILD_NUMBER`; add `com.vibecode.ci.*` labels. |
| A2 | `post { always }` runs on ordinary test failures and user aborts; `post { cleanup }` runs last. Hard agent/daemon failures leave cleanup to the scheduled job. | A hard-killed build leaves resources until the next maintenance run. | Jenkins post-condition ordering; scheduled job is the safety net. |
| A3 | Per-build Compose images and build-scoped volumes are disposable; BuildKit layer cache remains. The Cypress stage already uses `down -v` for the same build project. | Removing build-scoped volumes would discard reusable data. | Cypress stage already removes them; only tagged project resources are removed, not the builder cache. |
| A4 | The scheduled job can run from the repository with Docker access on a dedicated node. Creating the Jenkins job from `Jenkinsfile.cleanup` is a rollout prerequisite; adding the file alone does not schedule anything. | The safety net would not exist until an administrator provisions the job. | Runbook step; Jenkins job configuration. |
| A5 | The local-dev stack is a separate project (`vibecoder-ai-planner`) and must never be selected. | `down -v` could delete local development data. | Strict `^vibecode-<branch>-<build>$` check plus explicit deny; negative tests. |
| A6 | The default deployment has one Docker daemon for Jenkins builds. Multiple daemons require one maintenance job per host with its own expected daemon ID. | A single job could clean only one host while others accumulate resources. | Explicit host/ID parameters; multi-host fan-out deferred (D5). |

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| Jenkinsfile | Fixes post ordering, adds CI labels, a `CI_SMOKE_FAIL` hook and the cleanup call; pins the pipeline to the dedicated Docker node. | this ticket |
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
| Plan review round 1 | Blocking findings B1-B4 addressed in this revision; re-review pending (`03` Review record) | ☑ |
| D13 helper available | PR #140 merged at `02ffc0a`; `agent/scripts/sandbox-ci-env.sh` is on master | ☑ |
| Plan merged | pending | ☐ |
| Implementation completed | pending | ☐ |
| Verification results | pending (`03` Results) | ☐ |

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
`vibecode-<branch>-<build>_postgres_data` are disposable copies. They are
removed by the validated project teardown. The local-dev volumes
`vibecoder-ai-planner_{postgres_data,uploads_data,vibecode_repos}` are not
build-scoped and must never be selected.
