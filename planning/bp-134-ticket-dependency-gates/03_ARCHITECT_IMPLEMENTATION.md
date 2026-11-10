# 03_ARCHITECT_IMPLEMENTATION.md - Ticket Dependency Gates and Readiness Enforcement (bp-134)

> **Owns:** work order, per-file changes, verification matrix, review record, results.
> **Not here:** requirements (`01`), design (`02`), status (`00`).

## Work order

1. Add a dependency-readiness helper in `TicketService` that resolves all dependencies in one bounded query and returns `ready`/`blockedBy` with fail-closed reasons, plus a batch variant for list endpoints.
2. Add the dependency-specific error class and expose `ready`/`blockedBy` on ticket reads.
3. Gate `pickUpTicket()`.
4. Gate `updateStatus()`, `update()` when entering `in_progress`, and `PhaseService.transition()` when the target enters execution, excluding `toPhase === 'blocked'`.
5. Gate **new** durable run creation in `HarnessRunService.startRun()`; leave `HarnessTicketProcessor.recoverRun()` exempt.
6. Filter blocked tickets from the agent backlog query (or skip without counting) and add `ready` to the Java `Ticket` model.
7. Add the read-only UI blocked/ready surface and reasons; no dependency editor.
8. Add audit/metrics for blocked starts and dependency reopen.
9. Run unit, API and PostgreSQL integration tests.

## Per-file changes

| File | Change |
|---|---|
| `backend/src/services/TicketService.js` | Readiness helper plus batch variant; call it from pickup/update/updateStatus; return `DEPENDENCIES_NOT_DONE` with `blockedBy[]` |
| `backend/src/errors/HttpError.js` | Add `DependencyConflictError extends ConflictError` (code `DEPENDENCIES_NOT_DONE`, `details`) or extend `ConflictError` with a code/details constructor |
| `backend/src/services/PhaseService.js` | Gate target phases that enter execution; explicitly allow `toPhase === 'blocked'` |
| `backend/src/services/HarnessRunService.js` | Gate new durable start by the same readiness helper |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | `recoverRun()` remains exempt and reports readiness/`dependency_reopened` |
| `backend/src/models/ticket.js` | Enrich list reads with a batch readiness projection or leave the model read-only and enrich in the service |
| `backend/src/api/tickets.js` | Document the new error/read fields; no new route required |
| `backend/src/controllers/ticketController.js` | Propagate the dependency error payload where the controller wraps service errors |
| `backend/src/services/TicketService.js` / `backend/src/models/ticket.js` | Own the project-ticket/backlog query; exclude blocked tickets and enrich lists in one batch |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | Backlog client consumes `ready`; no `AgentService.js` exists for this path |
| `agent/src/main/java/com/vibecode/agent/model/Ticket.java` | Add `ready` and optional `blockedBy` fields for the fallback skip path |
| `agent/src/main/java/com/vibecode/agent/AgentApp.java` | Defensive skip if a blocked ticket still appears; do not count it toward `MAX_TICKETS` |
| `frontend/src/api/tickets.ts` | Add `ready`/`blockedBy`/`reason` types and propagate errors |
| `frontend/src/views/TicketDetail.vue` | Read-only blocked list with links and reasons; no editor |
| `frontend/src/views/TicketBoard.vue` | Blocked indicator on cards |
| Tests | `TicketService` unit, API route, `PhaseService` (including blocked transition), `HarnessRunService`, recovery exemption, frontend tests, PostgreSQL integration |

## Verification matrix

| Requirement | Layer | Test / command | Evidence |
|---|---|---|---|
| FR1 | Unit/API/integration | `TicketService.pickUpTicket` rejects incomplete deps; API returns `409 DEPENDENCIES_NOT_DONE`; real PG pickup test | `npm test`; `npm run test:integration` |
| FR2 | Unit/integration | `updateStatus`, `update(status)`, `PhaseService.transition` blocked when entering execution; `in_progress → blocked` allowed; allowed when deps done | `npm test`; integration |
| FR3 | Unit/integration | `HarnessRunService.startRun` rejects a blocked new start; `HarnessTicketProcessor.recoverRun` remains exempt and does not strand a run | `npm test`; integration |
| FR4 | Unit | missing/deleted/self/cross-project dependency cases fail closed with a reason | `npm test` |
| FR5 | Unit/API | `DependencyConflictError` returns `409 DEPENDENCIES_NOT_DONE` with `details.blockedBy[]`; `ready`/`blockedBy` read fields; nullable title/status for unresolved IDs | `npm test`; API tests |
| FR6 | Unit/API | backlog query excludes blocked tickets; planner/project list still includes them; list enrichment is batched | `npm test`; API tests |
| FR7 | Frontend | blocked badge/list/reasons render; no editor is claimed; errors surface | `npm test -- --run`; `npm run typecheck` |
| FR8 | Unit/integration | blocked attempt emits one structured log/event with ids and reason | `npm test`; log assertion |
| NFR1 | Unit/integration | concurrent dependency reopen and start serialize via dependency-row locks; no check/write window | integration test |
| NFR2 | Unit/regression | existing done/review/in-progress, recovery and phase-completion tests unchanged; `in_progress → blocked` allowed | `npm test` |
| NFR3 | Unit/performance | one bounded single-ticket query; list enrichment uses one batch query, no N+1 | query-count/EXPLAIN test |
| NFR4 | Unit | cross-project/self/circular handling and project membership | `npm test` |
| NFR5 | Unit | malformed/unresolvable dependency array fails closed | `npm test` |
| NFR6 | Review/static | no second dependency table or completion definition added | code review |

## Review record

| Round | Finding | Resolution | Status |
|---|---|---|---|
| 0 | Plan review pending | — | open |
| 1 | Atomicity assumed dependencies cannot reopen; durable recovery path was wrong; `in_progress → blocked` would be blocked; UI claimed a nonexistent editor; backlog owner/error class/model/batch details were incomplete | Added dependency-row locking and reopen semantics, narrowed the gate to new starts with recovery exempt, excluded `blocked`, removed the editor claim, and corrected `ApiService`/`HttpError`/`Ticket.java`/batch-list details | resolved |

## Results

No implementation results yet. This suite is planned.
