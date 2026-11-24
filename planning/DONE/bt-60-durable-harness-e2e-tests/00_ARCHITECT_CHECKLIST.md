---
id: "bt-60"
title: "Durable Harness End-to-End Tests"
status: done
priority: "P1"
effort: "Medium"
scope: "Both"
created: "2026-11-02"
updated: "2026-11-24"
pr: 207
branch: "test/bt-60-phase-b"
depends_on: ["fg-33"]
---

# 00 — Durable Harness End-to-End Tests (bt-60)

> **Owns:** status, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix
> (`03`), file operations (`04`).

**Test-only ticket.** No production behavior change. Never use a production
ticket, repository, PR or data.

**Runbook:** `05_RUNBOOK.md`.

## Why this ticket exists

fg-33 slice 1 added durable harness runs, checkpoints and leases, but the
coverage is split across layers: the Java client is tested against a stub
server, the routes are tested with the service mocked, the service is tested
against Postgres, and the supervisor is tested with `ApiService` mocked. No
test proves that the layers compose, and no disposable staging run has
validated the real OpenCode/GitHub/PR path. A path, body, auth or
finish-failure mismatch can pass every current test.

**Readiness:** fg-33 slices 1-3 are merged (#110). Phase A (#198) and the
Phase B automated drills (#207) are merged. fg-44 (foundation #209, supervisor
lifecycle #212) is merged, so the storage-lifecycle prerequisite is satisfied.
The disposable staging run was first executed on 2026-11-23 against a local
stack and `proundmega/planner-test` (runs `1af4a751`, `74216219`, `d23b7862`,
`5a80e787`; PRs #20-#23). The formal rerun on merged `master` (`110aa97`) ran
on 2026-11-24 (`98d6f814`, PR #24, `head_sha=4b80530`) with the #220 health
gate, child isolation and PAT fixes; there is no external credential blocker.
The fg-54 clean cut replaced project-bound agents with enrolled nodes and
declared runtimes; the fixtures, failure drills and cleanup SQL in this suite
now use `agent_nodes`/`agent_runtimes` and `runtime_id`. See
`planning/DONE/fg-54-agent-fleet/05_RUNBOOK.md` for the enrollment path.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | PR #111 | ☑ |
| Phase A implemented | PR #198, merged as `19cfc33`; exposed the usage-flush defect fixed in #200 | ☑ |
| Phase B automated drills | PR #207, merged as `c0ff5c0`; `harnessHttpE2E` E19-E21/E29; backend integration 21 suites / 167 tests | ☑ |
| Phase B staged | 2026-11-23 local disposable stack + `planner-test`; happy path (`1af4a751`, PR #20), lease loss (`74216219`, PR #21), health gate (`d23b7862`, PR #22) and crash/restart (`5a80e787`, PR #23) | ☑ |
| Master staging rerun | 2026-11-24 on `master` `110aa97`: run `98d6f814`, PR #24, `head_sha=4b80530`, health gate passed, full checkpoint sequence, no lease | ☑ |
| Staging cleanup | 2026-11-24: PRs #20-#24 closed and their branches deleted; `vibecode` counts verified 0 (`projects`, `tickets`, `harness_runs`, `harness_checkpoints`, `harness_leases`, `agent_nodes`, `agent_runtimes`, `provider_credentials`, `project_repos`, `users`). The staging directory `/tmp/opencode/bt60-staging` and its `provider.env`, `provider-values.json`, `mint.json` and `enrollment-token.txt` are gone; a sweep of `/tmp` and the OpenCode storage found no live bt-60 credential values (the literal `CREDENTIAL_NAME=bt60` string remains only in docs/session history, and expired `enr_...` fixtures exist). `pr207-pg` was removed with its anonymous volume; the staging API/proxy, Redis container and `:bt60` images are gone. `bt60-staging-pg` is retained as the shared local integration database and holds no staging rows. | ☑ |
| Reset attribution | The `vibecode` reset coincided with a backend integration-test run against the same `localhost:5432/vibecode` URL at 2026-11-24 04:15-04:17Z; `backend/src/__tests__/integration/setup.js:49` runs `DROP SCHEMA public CASCADE` when `INTEGRATION_TESTS=1`. The launching session is unidentified. The reset also removed the GTD staging project 2 (outside bt-60, `gtd-staging`); GTD PR #19 in `proundmega/gtd` remains open. | ☑ |
| Verification results | `03` Results, 2026-11-24 (Phase A, automated drills, 2026-11-23 staging and master rerun) | ☑ |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Agent startup recovery and `listActiveRunsForAgent` | fg-33 | Reliability | fg-33 (#110) | done |
| D2 | Resume/restart policy per checkpoint (`HARNESS_RESUME_MODE`) | fg-33 | Reliability | fg-33 (#110) | done |
| D3 | Scheduled reaper wiring and guarded ticket release | fg-33 | Reliability | fg-33 (#110) | done |
| D4 | Idempotent publish: branch/PR detection and duplicate-PR prevention | fg-33 | Reliability | fg-33 (#110) | done |
| D5 | Dead-letter/adoption flow for operators | fg-33 | Operations | fg-33 (#110) | done |
| D6 | Full workspace inventory and retention metrics (scheduled pruning delivered by fg-58) | fg-33 | Storage | DONE/fg-33-durable-harness-execution (D8) | open |
| D7 | Automated fault injection for `/finish`, lease loss, mid-run key expiry, crash/restart | self | Testing | bt-60 Phase B; lease-expiry/reaper adoption and idempotent publish are automated; lease loss and a real supervisor restart were validated in staging, while finish failure and key expiry remain | partial (#20-#24; finish/key expiry open) |
| D8 | Fully containerized real-agent e2e in CI | self | Testing | follow-up | open |
| D9 | Sandbox isolation for the real staging run | fg-34 | Security | fg-34-harness-sandbox | done (#139); Docker mode is the staging default |
| D10 | Run correlation, events and dashboards for e2e evidence | fg-41 | Observability | DONE/fg-41-harness-observability | done (#163/#165) |
| D11 | Redaction and retention for captured test artifacts | fg-42 | Privacy | DONE/fg-42-harness-privacy | done (#166) |
| D12 | Harness usage flush failed with `could not determine data type of parameter $1`, leaving `artifacts_finalized_at` NULL and the reaper retrying forever (found by Phase A E12) | self | Reliability | PR #200 (separate production fix) | done (#200, `865565e`) |
| D13 | OpenCode Go requires `x-opencode-session`; OpenCode 1.19.5 (the harness-compatible version) does not send it, so direct calls and the backend model test fail with 400 | self | Provider | fg-30 follow-up | open |
| D14 | `sandbox_ready` / `sandbox_bridge_ready` checkpoints are emitted but rejected by the validator, leaving warnings and no row | self | Observability | fg-30/fg-33 follow-up | open |
| D15 | Staging credential revocation | self | Security | The 2026-11-23/24 runs used PAT local mode (fg-35 local-only, `ALLOW_PAT=true`) and a disposable spend-capped provider key. The plaintext staging files (`provider.env`, `provider-values.json`) and the unused enrollment token are gone, and a sweep found no live staging credential values. D15 covers only GitHub-side PAT revocation and provider-side key revocation, which remain operator actions; it does **not** cover a local plaintext copy. Use a repo-scoped App installation for non-local runs. | open (operator action) |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Staging project/repo/node/runtime and provider/GitHub credentials | provide now / defer | Use a dedicated disposable set, never production | Executed 2026-11-23: disposable local project/node/runtime, `planner-test`, PAT local mode and a disposable provider key |
| 2 | Phase split | A only / A+B now | Both dependencies are satisfied; run A+B | Phase A merged; Phase B automated drills, 2026-11-23 staging and the master rerun (#24) executed |
| 3 | Staging GitHub auth and token revocation | PAT local mode / App installation | App installation for any non-local run; PAT only for local disposable staging | Used PAT local mode per fg-35 on 2026-11-23/24 (`ALLOW_PAT=true`); the stored token and plaintext staging files were removed and a sweep found no live staging credential values. GitHub-side revocation of the disposable PAT and provider-key revocation are operator actions (D15). |

## Completion gate

- [x] FR1-FR10 are met; NFR1-NFR2 are met; NFR3 is met with the documented local-mode credential exception (D15: the stored rows and plaintext staging files are gone; GitHub-side PAT revocation and provider-side key revocation remain operator actions)
- [x] Staging artifacts are cleaned up and verified (2026-11-24); the retained `bt60-staging-pg` integration database and the integration-run reset/GTD collateral are disclosed above
- [x] Verification matrix in `03` is green and results are recorded
- [x] `status` above is `done` and the test evidence is linked
- [x] Deferred register reflects what was actually left out
- [x] No production ticket, repo, PR or data was used
