# 03 — Implementation (fg-41)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Define the harness event schema and versioning
- [x] Add run/trace correlation IDs
- [x] Persist events with bounded retention
- [ ] Add replay of a failed run (events + diff + verification)
- [ ] Add dashboards for runs, failures, cost, review/fix rounds
- [ ] Add alerts for stuck runs, secret leakage and cost spikes
- [ ] Add immutable audit events for publish/review/merge
- [x] Define redaction at the event boundary
- [x] Test ordering, retention, redaction and replay

This PR is slice 1: event schema, append-only store, sink, redaction and
retention. Replay, dashboards and audit are delivered in PR #165.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/051_harness_events.sql` (+ rollback) | add | Append-only `harness_events` with `event_timestamp`, tenant/run/type indexes, `harness_runs.project_id` backfill, update/delete trigger and retention purge guard |
| `backend/src/utils/harnessRedaction.js` | add | Ingest-time credential redaction, token-count exclusion, file/prompt hashing, truncation and secret flag |
| `backend/src/services/HarnessEventService.js` | add | Validated, idempotent append; run-bound tenant derivation; event-time ordering; replay data; retention |
| `backend/src/services/HarnessMetrics.js` | change | Event, duplicate, rejection, purge and secret metrics |
| `backend/src/api/harnessObservability.js` | add | Agent event ingestion; run-scoped and project-scoped event reads |
| `backend/src/api/v1/index.js` | change | Mount the observability router |
| `backend/src/services/HarnessRunService.js` | change | Persist `project_id` on new runs; emit a terminal event fallback from `finishRun` |
| `backend/src/index.js` | change | Scheduled bounded event retention |
| `agent/.../HarnessEventContext.java` | add | trace/run/ticket/project/agent/session correlation record |
| `agent/.../HarnessEventSink.java` | add | Best-effort emission boundary |
| `agent/.../HttpHarnessEventSink.java` | add | HTTP event shipment with redaction and failure cooldown |
| `agent/.../HarnessPayloadRedactor.java` | add | Emission-time redaction, content hashing, token-count exception |
| `agent/.../HarnessDigest.java` | add | SHA-256 helper for hashes |
| `agent/.../OpenCodeUsage.java` | add | Defensive token/tool extraction from OpenCode events |
| `agent/.../HarnessTicketProcessor.java` | change | Emit run/step/prompt/tool/file/verification/diff/publish/terminal events |
| `agent/.../service/ApiService.java` | change | Event shipment uses a short event-specific HTTP timeout |
| `backend/src/__tests__/integration/harnessEventStoreMigration.test.js` | add | Real Postgres migration/trigger/purge/rollback coverage |

## Dependencies

- fg-30, fg-33 (done)
- Stacked base for fg-38 (#164) and fg-41 slice 2 (#165)

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend | `harnessEventService.test.js` | validates ids/type/timestamp and stores versioned event | `cd backend && npm test -- --runInBand` |
| FR2 | Agent | `HarnessTicketProcessorTest.java` | emits run/step/prompt/tool/verification/diff/publish/terminal types | `cd agent && mvn test` |
| FR3 | Agent + Backend | `HarnessTicketProcessorTest.java`, `api-harness-observability.test.js` | trace id shared; operator reads fall back to the ticket project | `mvn test`, `npm test` |
| FR4 | Both | `harnessRedaction.test.js`, `HarnessPayloadRedactorTest.java`, `HttpHarnessEventSinkTest.java` | keys/tokens/content/prompt redaction, token-count fields preserved | `npm test`, `mvn test` |
| FR5 | Backend | `harnessEventService.test.js`, `harnessEventStoreMigration.test.js` | append-only trigger, retention purge opt-in, rollback removes schema | `npm test`, `npm run test:integration` |
| FR6 | Backend | `harnessEventService.test.js` | event-time ordering and artifact extraction (route arrives in #165) | `npm test` |
| FR7 | — | — | dashboards in #165 | — |
| FR8 | — | — | alerts in #165 | — |
| FR9 | — | — | audit in #165 | — |
| FR10 | Backend | `api-harness-observability.test.js` | agent read scoping; project membership required | `npm test` |

## Review checklist

- [x] Every `FR*`/`NFR*` delivered by this slice has a passing row
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration has a rollback and is registered in `apply.js`
- [x] API contract matches `02`; OpenAPI/types regenerated if it changed
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-16 | PR #163 | fg-41 slice 1 | Implemented; backend and agent suites green; migration trigger/rollback covered against real Postgres; pending review/merge |
