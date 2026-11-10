# 03_ARCHITECT_IMPLEMENTATION.md - Ticket Dependency Gates and Readiness Enforcement (bp-134)

> **Owns:** work order, per-file changes, verification matrix, review record, results.
> **Not here:** requirements (`01`), design (`02`), status (`00`).

## Work order

1. Add a dependency-readiness helper in `TicketService` that resolves all dependencies in one bounded query and returns `ready`/`blockedBy` with fail-closed reasons.
2. Add the shared error/contract and expose `ready`/`blockedBy` on ticket reads.
3. Gate `pickUpTicket()`.
4. Gate `updateStatus()`, `update()` when entering `in_progress`, and `PhaseService.transition()` when the target maps to `in_progress`.
5. Gate durable run creation/recovery in `HarnessRunService`.
6. Filter blocked tickets from the agent backlog query (or skip without counting).
7. Add the UI blocked/ready surface and dependency links.
8. Add audit/metrics for blocked starts.
9. Run unit, API and PostgreSQL integration tests.

## Per-file changes

| File | Change |
|---|---|
| `backend/src/services/TicketService.js` | Readiness helper; call it from pickup/update/updateStatus; return `DEPENDENCIES_NOT_DONE` with `blockedBy[]` |
| `backend/src/services/PhaseService.js` | Gate target phases that map to `in_progress` |
| `backend/src/services/HarnessRunService.js` | Gate durable run start/recovery by the same readiness helper |
| `backend/src/models/ticket.js` | Expose `ready`/`blockedBy` read fields or leave model read-only and enrich in the service |
| `backend/src/api/tickets.js` | Document the new error/read fields; no new route required |
| `backend/src/controllers/ticketController.js` | Propagate the dependency error payload where the controller wraps service errors |
| `backend/src/services/AgentService.js` or the backlog query owner | Exclude blocked tickets from the agent backlog result |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | Defensive skip if a blocked ticket still appears; do not count it toward `MAX_TICKETS` |
| `frontend/src/api/tickets.ts` | Add `ready`/`blockedBy` types and propagate errors |
| `frontend/src/views/TicketDetail.vue` | Blocked badge/list and dependency links |
| `frontend/src/views/TicketBoard.vue` | Blocked indicator on cards |
| Tests | `TicketService` unit, API route, `PhaseService`, `HarnessRunService`, frontend tests, PostgreSQL integration |

## Verification matrix

| Requirement | Layer | Test / command | Evidence |
|---|---|---|---|
| FR1 | Unit/API/integration | `TicketService.pickUpTicket` rejects incomplete deps; API returns `409 DEPENDENCIES_NOT_DONE`; real PG pickup test | `npm test`; `npm run test:integration` |
| FR2 | Unit/integration | `updateStatus`, `update(status)`, `PhaseService.transition` blocked into `in_progress`; allowed when deps done | `npm test`; integration |
| FR3 | Unit/integration | `HarnessRunService.startRun` / recovery rejects a blocked ticket | `npm test`; integration |
| FR4 | Unit | missing/deleted/self/cross-project dependency cases fail closed | `npm test` |
| FR5 | Unit/API | `blockedBy[]` payload and `ready`/`blockedBy` read fields | `npm test`; API tests |
| FR6 | Unit/API | backlog query excludes blocked tickets; planner/project list still includes them | `npm test`; API tests |
| FR7 | Frontend | blocked badge/list and dependency links render; errors surface | `npm test -- --run`; `npm run typecheck` |
| FR8 | Unit/integration | blocked attempt emits one structured log/event with ids and reason | `npm test`; log assertion |
| NFR1 | Unit/integration | concurrent/racing edit cannot flip readiness between check and update | integration test |
| NFR2 | Unit/regression | existing done/review/in-progress and phase-completion tests unchanged | `npm test` |
| NFR3 | Unit/performance | one bounded dependency query; no N+1 on backlog listing | query-count/EXPLAIN test |
| NFR4 | Unit | cross-project/self/circular handling and project membership | `npm test` |
| NFR5 | Unit | malformed/unresolvable dependency array fails closed | `npm test` |
| NFR6 | Review/static | no second dependency table or completion definition added | code review |

## Review record

| Round | Finding | Resolution | Status |
|---|---|---|---|
| 0 | Plan review pending | — | open |

## Results

No implementation results yet. This suite is planned.
