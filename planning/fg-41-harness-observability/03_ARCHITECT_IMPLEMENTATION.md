# 03 — Implementation (fg-41)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Define the harness event schema and versioning
- [x] Add run/trace correlation IDs
- [x] Persist events with bounded retention
- [x] Add replay of a failed run (events + diff + verification)
- [x] Add dashboards for runs, failures, cost, review/fix rounds
- [x] Add alerts for stuck runs, secret leakage and cost spikes
- [x] Add immutable audit events for publish/review/merge
- [x] Define redaction at the event boundary
- [x] Test ordering, retention, redaction and replay

Merge/rollback audit records are implemented but have no producer until
`fg-36` (deferred D5).

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/051_harness_events.sql` (+ rollback) | add | Append-only `harness_events` with `event_timestamp`, tenant/run/type indexes, `project_id` alert-time expression index, `harness_runs.project_id` backfill, update/delete trigger and retention purge guard |
| `backend/src/utils/harnessRedaction.js` | add | Ingest-time credential redaction, file/prompt hashing, truncation and secret flag |
| `backend/src/services/HarnessEventService.js` | add | Validated, idempotent append; run-bound tenant derivation; timeline/replay; audit listing; retention; synthetic terminal event |
| `backend/src/services/HarnessAuditService.js` | add | Immutable publish/review audit records with actor, reason, SHA and PR |
| `backend/src/services/HarnessDashboardService.js` | add | Runs/throughput/duration, cost/tokens, stuck runs, review/fix rounds, tool failures, secret hits and alerts |
| `backend/src/services/HarnessMetrics.js` | change | Event, rejection, purge, secret, budget and stuck-run metrics |
| `backend/src/api/harnessObservability.js` | add | Agent event/usage ingestion; operator run/event/audit/timeline/dashboard/policy/kill-switch routes |
| `backend/src/api/harnessRuns.js` | change | Budget policy in start response; publish/finish audit; terminal event and billing flush |
| `backend/src/api/v1/index.js` | change | Mount the observability router |
| `agent/.../HarnessEventContext.java` | add | trace/run/ticket/project/agent/session correlation record |
| `agent/.../HarnessEventSink.java` | add | Best-effort emission boundary |
| `agent/.../HttpHarnessEventSink.java` | add | HTTP event shipment with redaction and failure counters |
| `agent/.../HarnessPayloadRedactor.java` | add | Emission-time redaction, content hashing and truncation |
| `agent/.../HarnessDigest.java` | add | SHA-256 helper for hashes |
| `agent/.../OpenCodeUsage.java` | add | Defensive token/tool extraction from OpenCode events |
| `agent/.../HarnessTicketProcessor.java` | change | Emit run/step/prompt/tool/verification/diff/publish/terminal events; report usage; correlate by trace/run |
| `frontend/src/api/harnessObservability.ts` | add | Dashboard, timeline, event, audit, policy and kill-switch client |
| `frontend/src/views/HarnessObservability.vue` | add | Project dashboard, alerts, policy editor, kill switch, replay timeline and audit table |
| `frontend/src/router/index.ts`, `views/ProjectDetail.vue` | change | Project-scoped route and quick link |

## Dependencies

- fg-30, fg-33 (done)

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend | `backend/src/__tests__/harnessEventService.test.js` | validates ids/type and stores versioned event | `cd backend && npm test -- --runInBand` |
| FR2 | Agent | `agent/.../HarnessTicketProcessorTest.java` | emits run/step/prompt/tool/verification/diff/publish/terminal types | `cd agent && mvn test` |
| FR3 | Agent + Backend | `HarnessTicketProcessorTest.java`, `api-harness-observability.test.js` | trace id shared across timeline; backend derives run/ticket/project | `mvn test`, `npm test` |
| FR4 | Both | `harnessRedaction.test.js`, `HarnessPayloadRedactorTest.java`, `HttpHarnessEventSinkTest.java` | keys/tokens/.env/content/prompt redaction + secret flag | `npm test`, `mvn test` |
| FR5 | Backend | `harnessEventService.test.js` | append-only trigger, retention purge opt-in, audit window | `npm test` |
| FR6 | Backend | `harnessEventService.test.js` | timeline includes events, checkpoints, artifacts and verification commands | `npm test` |
| FR7 | Backend + UI | `harnessDashboardService.test.js`, `harnessObservabilityApi.test.ts` | runs, success rate, p50/p95, cost, review/fix rounds | `npm test`, `npm test -- --run` |
| FR8 | Backend | `harnessDashboardService.test.js` | stuck run, failure spike, repeated failure, budget, secret and diff alerts | `npm test` |
| FR9 | Backend | `api-harness-observability.test.js` | review events create audit records; publish create helper is deduplicated | `npm test` |
| FR10 | Backend | `api-harness-observability.test.js` | agent can only read its own run; project membership required | `npm test` |

## Review checklist

- [x] Every `FR*`/`NFR*` has a passing row in the matrix
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration has a rollback and is registered in `apply.js`
- [x] API contract matches `02`; OpenAPI/types regenerated if it changed
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

OpenAPI was regenerated (`npm run generate:spec`); the frontend client was
written by hand because the generated client does not yet include harness
observability operations.

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-16 | stacked PRs #163/#164/#165 | fg-41 slices 1-2 | Implemented; backend 144/144 suites (1815 tests), agent 728 tests and frontend 571 tests green; pending review/merge |
