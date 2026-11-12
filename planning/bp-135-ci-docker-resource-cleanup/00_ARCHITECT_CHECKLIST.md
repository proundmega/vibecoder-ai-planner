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

Failed or aborted Jenkins builds leave per-build Compose images, sandbox/proxy
images, containers and networks behind. The current pipeline only runs Compose
teardown in `post { success { ... } }`; the failure path just logs. A long-lived
Jenkins host therefore accumulates hundreds of images and running containers,
which wastes disk and can make later scans or tests target stale resources.

The fix has two layers: each build cleans up after itself even on failure, and a
scheduled maintenance job removes resources that survive a killed agent or a
Jenkins crash.

## Requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Every pipeline run tears down its own Compose project in `post { always }`, including failure and abort paths. | A failed smoke build runs `docker compose -p "$COMPOSE_PROJECT_NAME" down -v --rmi local --remove-orphans`; the project's containers, network and locally built images are gone. |
| FR2 | CI-built images are labelled with `com.vibecode.ci=true`, `com.vibecode.ci.job` and a unique build identifier (or an equivalent unique tag). | `docker image inspect` shows the labels on the supervisor, sandbox and proxy images built by a run. |
| FR3 | A scheduled Jenkins maintenance job removes orphaned CI resources by label and age: sandbox containers/networks older than the grace period, CI images older than the image grace period, and stopped Compose projects whose build is no longer running. | A fixture with old labelled resources is removed; current resources and unlabelled resources are left untouched. |
| FR4 | Cleanup is scoped and safe: no `docker system prune -a`, no removal of shared data volumes (`postgres_data`, `uploads_data`, `vibecode_repos`), no removal of non-`vibecode` resources, and no resource newer than the grace period. | Script test asserts the exact filters and asserts that no broad prune or shared-volume removal command is issued. |
| FR5 | Cleanup uses the same Docker daemon as the build, via the shared `sandbox-ci-env.sh` selection (or equivalent). | A cleanup invoked with the CI environment talks to the daemon printed by the build stage; `--dry-run` reports the same host. |
| NFR1 | Cleanup is idempotent and non-fatal for the build: missing resources are ignored; a failed `post` cleanup warns but does not turn a successful build into a failure. The scheduled job reports failures. | Re-running cleanup exits 0; simulated `docker` failure still leaves the build result unchanged; scheduled job exits non-zero. |
| NFR2 | Cleanup cannot race a concurrent build: the grace period is longer than the pipeline timeout, and labels/project names uniquely identify a build. | A resource younger than the grace period is never selected; two concurrent builds' resources have distinct labels/project names. |
| NFR3 | The cleanup script has deterministic regression coverage with a fake `docker` binary. | `JenkinsDockerCleanupScriptTest` covers compose teardown, orphan filtering, dry-run, age cutoff and shared-volume protection. |
| NFR4 | Retention values are configurable and documented. | `CI_IMAGE_GRACE_HOURS`, `CI_CONTAINER_GRACE_HOURS` and `CI_BUILD_GRACE_HOURS` are read from environment; defaults are documented in the runbook. |

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence |
|---|---|---|---|
| A1 | The Docker daemon is shared by Jenkins builds and CI resources are distinguishable by label or unique project/build name. | Cleanup could remove another build's images or containers. | Compose project names already include branch/build; add labels and age filters. |
| A2 | `post { always }` runs on ordinary test failures and user aborts; hard agent/daemon failures leave cleanup to the scheduled job. | A hard-killed build leaves resources until the next maintenance run. | Jenkins semantics; scheduled job is the safety net. |
| A3 | Per-build Compose images do not need to survive the build; they can be rebuilt on the next run. | `--rmi local` would discard a reusable cache. | BuildKit layer cache remains; only the tagged project images are removed. |
| A4 | The scheduled job can run from the repository with the CI helper and Docker access. | Orphan cleanup needs a separate host-side script. | Jenkins already runs Docker stages; the maintenance job uses the same agent label. |
| A5 | Shared named volumes are never per-build and must be preserved. | Cleanup could delete data. | `docker compose down` without `-v` for shared stacks; explicit volume-protection test. |

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| Jenkinsfile / CI scripts | Adds `post { always }` teardown, build labels and a cleanup script; changes the success-only teardown. | this ticket |
| Compose files | May add build labels so images are discoverable; existing project names remain the primary scope. | this ticket |
| API, DB, frontend, agent boundary | n/a — CI/infra only. | n/a |
| Rollback | Revert the Jenkinsfile/script changes; labels are inert. | git revert |

## Readiness gate (before implementation)

- [ ] Scope is one layer and the root cause is understood
- [ ] Every requirement above has a testable acceptance statement
- [ ] Assumptions are listed with a validation path
- [ ] The verification command/test is identified
- [ ] No API, database, auth, migration or agent-boundary change is involved

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | pending | ☐ |
| Implementation completed | pending | ☐ |
| Verification results | pending (`03` Results) | ☐ |

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Host cron/systemd timer for when Jenkins itself is down and cannot run the scheduled maintenance job. | self | Operability | fg-43 or follow-up | open |
| D2 | BuildKit cache pruning beyond labelled images; this ticket removes images/containers but not the builder cache. | self | Capacity | follow-up | open |
| D3 | Environment-specific retention tuning beyond the documented defaults. | self | Operability | none | open |
| D4 | Reuse the D13 helper (`agent/scripts/sandbox-ci-env.sh`, #140) once merged; if not available, the cleanup script must duplicate the daemon selection. | fg-34 D13 | Dependency | fg-34 | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Where should cleanup run? | A: pipeline only; B: scheduled Jenkins job only; C: both | C — `post { always }` for build-scoped teardown, plus a scheduled label/age GC for crashes and hard kills | C (recommended; pending approval) |
| 2 | Default image/container grace periods? | A: 24h images / 2h containers; B: 48h / 6h; C: other | A — longer than the 60-minute pipeline timeout, short enough to bound disk | A (recommended; pending approval) |
| 3 | Remove per-build Compose images on every run? | A: yes, `--rmi local`; B: only on failure | A — build cache remains and disk stays bounded | A (recommended; pending approval) |

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
the same repository script, daemon selection and log retention as the pipeline.
A host timer can be added later for the case where Jenkins itself is down
(D1). The pipeline cleanup is the primary fix; the scheduled job is the safety
net.
