---
id: "bt-60"
title: "Durable Harness End-to-End Tests"
status: planned
priority: "P1"
effort: "Medium"
scope: "Both"
created: "2026-11-02"
updated: "2026-11-03"
pr: null
branch: null
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

**Readiness:** fg-33 slices 1-3 are merged (#110). The Phase A and Phase B
dependencies are both satisfied; the remaining blocker is the disposable
staging project/repo/agent, provider key and GitHub token.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | PR #111 | ☑ |
| Implementation merged | pending — staging credentials required | ☐ |
| Verification results | n/a — planned | ☐ |

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
| D6 | Full workspace inventory, retention metrics and scheduled pruning | fg-33 | Storage | fg-44-agent-storage-lifecycle | open |
| D7 | Automated fault injection for `/finish`, lease loss, mid-run key expiry, crash/restart | self | Testing | bt-60 Phase B | open |
| D8 | Fully containerized real-agent e2e in CI | self | Testing | follow-up | open |
| D9 | Sandbox isolation for the real staging agent | fg-34 | Security | fg-34-harness-sandbox | open |
| D10 | Run correlation, events and dashboards for e2e evidence | fg-41 | Observability | fg-41-harness-observability | open |
| D11 | Redaction and retention for captured test artifacts | fg-42 | Privacy | fg-42-harness-privacy | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Staging project/repo/agent and provider/GitHub credentials | provide now / defer | Use a dedicated disposable set, never production | Pending |
| 2 | Phase split | A only / A+B now | Both dependencies are satisfied; run A+B | Pending |

## Completion gate

- [ ] Every `FR*`/`NFR*` acceptance statement in `01` is met
- [ ] Verification matrix in `03` is green and results are recorded
- [ ] `status` above is `done` and the test evidence is linked
- [ ] Deferred register reflects what was actually left out
- [ ] No production ticket, repo, PR or data was used
