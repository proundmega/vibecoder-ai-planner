# 03 — Implementation (fg-51)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

1. **Registry + mapping format** — parse `01` requirements; support manifest and
   annotations; reject duplicates/unknown IDs — verify:
   `cd backend && npm test -- traceability`.
2. **Evidence adapters** — JUnit XML, Jest/Vitest JSON, pytest JSON, CI and
   supervisor results; cap size/time — verify:
   `cd backend && npm test -- traceability`.
3. **Trace service + migration** — persist snapshots per SHA; idempotent
   recompute; gap-report endpoint — verify:
   `cd backend && npm test -- traceability`.
4. **Gate + waiver + audit** — `off|warn|enforce`; scoped waivers; events;
   project membership — verify:
   `cd backend && npm test -- traceability`.
5. **Reviewer/fixer/merge integration** — gap report in `fg-31` context, fix
   request IDs in `fg-32`, stale-SHA check in `fg-36` — verify:
   `cd agent && mvn test` and backend contract tests.
6. **UI** — traceability panel on `TicketDetail`; counts + rows — verify:
   `cd frontend && npm test -- TicketDetail`.
7. **Docs + rollout** — flag documentation, pilot instructions and waiver
   runbook — verify: `node planning/check-planning.js`.

## Per-file changes

Indicative; exact signatures belong in `04` if one is written.

| File | Action | Change |
|---|---|---|
| `backend/src/services/RequirementTraceService.js` | CREATE | Registry, mapping, evidence adapters, status rules, gap report |
| `backend/src/services/RequirementTraceService.test.js` | CREATE | Unit tests for every status rule and adapter |
| `backend/src/controllers/traceability.js` | CREATE | Read/recompute/waive/revoke handlers |
| `backend/src/api/v1/tickets.js` | MODIFY | Mount traceability routes |
| `backend/src/migrations/NNN_ticket_requirement_trace.sql` | CREATE | Trace + event tables |
| `backend/src/migrations/NNN_ticket_requirement_trace_rollback.sql` | CREATE | Drop tables/indexes |
| `backend/src/migrations/apply.js` | MODIFY | Register the migration |
| `backend/src/middleware/permissions.js` | MODIFY | Add `TICKET_TRACEABILITY_WAIVE` |
| `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java` | MODIFY | Expose command/exit/SHA for evidence |
| `agent/src/main/java/com/vibecode/agent/service/ReviewProcessor.java` | MODIFY | Include the gap report in review context |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | MODIFY | Consume traceability gate failures |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Traceability panel |
| `frontend/src/api/tickets.ts` | MODIFY | Traceability client calls |
| `planning/03_ARCHITECT_IMPLEMENTATION.md` | MODIFY | Document the requirement-ID test naming convention |
| `planning/README.md` | MODIFY | Document the traceability gate |

## Dependencies

- `fg-31` owns the review + supervisor verification result this ticket consumes.
- `fg-45` owns requirement IDs, acceptance and the risk sections.
- `fg-48` owns planning-document consistency; this ticket owns runtime evidence.
- `fg-32` consumes the gap report for fix requests.
- `fg-36` consumes the latest snapshot at merge.
- `fg-41` consumes the events.

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | duplicate/missing-acceptance requirement fails; clean registry passes | `cd backend && npm test -- traceability` |
| FR2 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | manifest and annotation mappings resolve; unmapped requirement is missing | `cd backend && npm test -- traceability` |
| FR3 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | JUnit/Jest/Vitest/pytest fixtures map tests; failing/absent test is not verified | `cd backend && npm test -- traceability` |
| FR4 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | passing verification marks verified; failed/timed-out marks partial/missing | `cd backend && npm test -- traceability` |
| FR5 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | same SHA is idempotent; new SHA replaces the snapshot | `cd backend && npm test -- traceability` |
| FR6 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | counts equal rows; no composite score field | `cd backend && npm test -- traceability` |
| FR7 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | enforce blocks missing/partial; warn records and allows; off skips | `cd backend && npm test -- traceability` |
| FR8 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | scoped waiver allows named ID; other gaps block; expiry/audit tested | `cd backend && npm test -- traceability` |
| FR9 | Agent unit | `agent/src/test/java/com/vibecode/agent/harness/ReviewContextTest.java` | review context contains gap rows; fix request lists requirement IDs | `cd agent && mvn test` |
| FR10 | Frontend unit | `frontend/src/views/__tests__/TicketDetail.test.ts` | panel renders counts/rows; event carries ticket/`run_id` | `cd frontend && npm test -- TicketDetail` |
| NFR1 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | repeated runs are deterministic and offline | `cd backend && npm test -- traceability` |
| NFR2 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | secrets are absent from rows/events/logs | `cd backend && npm test -- traceability` |
| NFR3 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | agent path cannot mutate repo or approve | `cd backend && npm test -- traceability` |
| NFR4 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | oversized/malformed report records `report_capped`/parse failure | `cd backend && npm test -- traceability` |
| NFR5 | Backend unit | `backend/src/services/RequirementTraceService.test.js` | grandfathered ticket is not blocked; enforce is explicit | `cd backend && npm test -- traceability` |

## Verification commands

```bash
node planning/check-planning.js
cd backend && npm test -- traceability
cd agent && mvn test
cd frontend && npm test -- TicketDetail
```

## Review record

| Round | Reviewer | Blocking findings | Resolution | Re-review |
|---|---|---|---|---|
| 0 | pending | pending | pending | pending |

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
