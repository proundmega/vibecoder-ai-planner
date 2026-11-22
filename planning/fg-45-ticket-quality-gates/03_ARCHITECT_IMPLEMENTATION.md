# 03 — Implementation (fg-45)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Test-First Requirement

Create these stubs **before** production code:

1. `backend/src/__tests__/readinessEvaluator.test.js` — every issue code,
   placeholders, risk sections, requirement IDs.
2. `backend/src/__tests__/ticketReadinessService.test.js` — approve, replan,
   override, small-fix, content-bound invalidation, sweep.
3. `backend/src/__tests__/projectAccessService.test.js` — owner/member/
   non-member/super_admin/runtime owner.
4. `backend/src/__tests__/readinessGate.test.js` — the five execution paths and
   `off|warn|enforce`.
5. `backend/src/__tests__/api-readiness.test.js` — route contracts, 409s,
   permissions, append-only audit.
6. `backend/src/__tests__/integration/ticketReadiness.test.js` — migration,
   backfill, real Postgres transaction/locking.
7. `agent/src/test/java/.../HarnessTicketProcessorReadinessTest.java` — post
   issues, release, no clone/harness.
8. `frontend/src/__tests__/readinessPanel.test.ts` — panel, actions, errors.
9. `frontend/src/__tests__/ticketBoardReadiness.test.ts` — drag/drop restores
   the column and shows issues.
10. `frontend/cypress/component/ReadinessPanel.cy.ts` — render/approve/override.

## Plan

1. **Migration** — `061_ticket_readiness.sql` (+ rollback): readiness columns,
   `ticket_acceptance_criteria`, `ticket_readiness_events`, permission seeds,
   grandfather backfill. If fg-55 has already taken 060, use the next free
   number and register it in `apply.js` array order.
2. **Project access** — `ProjectAccessService` with `isProjectMember` and
   `assertProjectMember`.
3. **Evaluator** — `ReadinessEvaluator` (pure checks) and
   `TicketReadinessService` (state, transactions, audit).
4. **Gates** — wire `assertReadyForExecution` into `pickUpTicket`,
   `updateStatus`, `update` (status change only), `PhaseService.transition`,
   and the planning-status guard.
5. **Routes/validators** — readiness, criteria, approve, small-fix, replan,
   override; permission codes; OpenAPI.
6. **Agent** — `ReadinessException` in `ApiService`, handled by
   `HarnessTicketProcessor`.
7. **Frontend** — readiness panel/issues, create wizard fields, board drag
   restoration, error propagation.
8. **Templates/docs** — add Assumptions/Change impact/Failure modes/Security
   sections to the root and product templates; do not add the fg-50 drift test
   (D7).
9. **Verification** — run the matrix and record results.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/061_ticket_readiness.sql` (+ rollback) | add | Columns, criteria/events tables, permission seeds, grandfather backfill |
| `backend/src/migrations/apply.js` | change | Register the migration in array order |
| `backend/src/services/ProjectAccessService.js` | add | `isProjectMember`, `assertProjectMember` |
| `backend/src/services/ReadinessEvaluator.js` | add | Pure issue checks, planning-file parsing, requirement IDs |
| `backend/src/services/TicketReadinessService.js` | add | `evaluate`, `assertReadyForExecution`, `approvePlan`, `replan`, `smallFix`, `override`, `revokeOverride`, `refreshReadyState`, `emitBlocked`, expiry sweep |
| `backend/src/services/TemplateService.js` | change | `requiredSections` metadata for built-in templates |
| `backend/src/services/TicketService.js` | change | Gate `pickUpTicket`, `updateStatus`, `update` |
| `backend/src/services/PhaseService.js` | change | Gate target phases mapping to `in_progress` |
| `backend/src/services/TicketPlanningService.js` | change | Reject `completed` and moves out of it; `REPLAN_REQUIRED` |
| `backend/src/api/tickets.js` | change | Readiness/criteria routes; error serialization |
| `backend/src/api/v1/index.js` | change | Mount the routes |
| `backend/src/validators/readiness.js` | add | Joi schemas for criteria, approve, small-fix, override |
| `backend/src/middleware/permissions.js` | change | Only if a helper is needed; permission codes are seeded in the migration |
| `agent/src/main/java/.../service/ApiResponse.java` | change | Error `details` map |
| `agent/src/main/java/.../service/ApiService.java` | change | `ReadinessException` with issues |
| `agent/src/main/java/.../harness/HarnessTicketProcessor.java` | change | Catch readiness, post issues, release, no clone/harness |
| `frontend/src/api/tickets.ts` | change | Propagate 409/details; add criteria calls |
| `frontend/src/api/readiness.ts` | add | Evaluate/approve/small-fix/replan/override |
| `frontend/src/components/ReadinessPanel.vue` | add | Badge, issues, actions, dialogs |
| `frontend/src/components/ReadinessIssues.vue` | add | Shared issue list |
| `frontend/src/views/TicketDetail.vue` | change | Mount the panel; planning status read-only when approved |
| `frontend/src/views/TicketBoard.vue` | change | Create wizard fields; restore drag on 409 |
| `frontend/src/__tests__/...` | add | Panel/board/API tests |
| `frontend/cypress/component/ReadinessPanel.cy.ts` | add | Component flow |
| `planning/00_ARCHITECT_CHECKLIST.md` template + root `01`/`02` | change | Add Assumptions/Change impact/Failure modes/Security sections |
| `planning/lightweight/00` | change | Add Assumptions/Change impact |
| `backend/src/services/TemplateService.js` built-ins | change | Same sections and `requiredSections` |

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend | `api-readiness.test.js` | create stays permissive; optional template/criteria | `cd backend && npm test` |
| FR2 | Backend | `ticketReadinessService.test.js` | criteria table authoritative; template seeds once | `npm test` |
| FR3 | Backend | `api-readiness.test.js` | `GET /readiness` returns issues/waivers/template | `npm test` |
| FR4 | Backend | `readinessGate.test.js` | pickup 409 `READINESS_FAILED` in enforce | `npm test` |
| FR5 | Backend | `readinessGate.test.js` | all five paths gated; `update` only on status change | `npm test` |
| FR6 | Backend | `ticketReadinessService.test.js` | `completed` is service-owned; 409 on direct set/move out | `npm test` |
| FR7 | Backend | `readinessEvaluator.test.js` | `{{...}}`, TBD, TODO, FIXME, empty sections | `npm test` |
| FR8 | Backend | `ticketReadinessService.test.js`, `api-readiness.test.js` | override permission, codes, expiry, revocation | `npm test` |
| FR9 | Backend | `ticketReadinessService.test.js` | small-fix waives template/files/sections only | `npm test` |
| FR10 | Agent | `HarnessTicketProcessorReadinessTest.java` | post issues, release, no clone/harness | `cd agent && mvn test` |
| FR11 | Frontend | `readinessPanel.test.ts`, `ticketBoardReadiness.test.ts`, `ReadinessPanel.cy.ts` | panel, wizard, drag restore, error propagation | `cd frontend && npm test -- --run`, `npm run cypress:component` |
| FR12 | Backend | `integration/ticketReadiness.test.js` | grandfather backfill keeps in-progress/review claimable | `cd backend && npm run test:integration` |
| FR13 | Backend | `ticketReadinessService.test.js` | readiness/blocked/time-to-ready metrics | `npm test` |
| FR14 | Backend | `ticketReadinessService.test.js`, `integration/ticketReadiness.test.js` | audit rows after COMMIT/ROLLBACK, `attempt_id` dedupe | `npm test`, `npm run test:integration` |
| FR15 | Backend | `projectAccessService.test.js` | owner/member/non-member/super_admin/runtime owner | `npm test` |
| FR16 | Backend | `ticketReadinessService.test.js` | passing edit keeps approval; failing edit invalidates; re-approve | `npm test` |
| FR17 | Backend | `readinessEvaluator.test.js` | assumptions missing/empty/“No material assumptions” | `npm test` |
| FR18 | Backend | `readinessEvaluator.test.js` | failure modes missing/empty/placeholder | `npm test` |
| FR19 | Backend | `readinessEvaluator.test.js` | security missing; security-sensitive simple blocked | `npm test` |
| FR20 | Backend | `readinessEvaluator.test.js` | change impact missing/empty; lightweight `n/a` passes | `npm test` |
| FR21 | Backend | `readinessEvaluator.test.js` | duplicate/renamed/removed FR IDs; approval requires replan | `npm test` |
| NFR1 | Backend | `ticketReadinessService.test.js` | bounded query/time budget; no open transaction during parse | `npm test` |
| NFR2 | Backend | `readinessGate.test.js`, integration rollback | `off`/`warn`/`enforce`; additive migration | `npm test`, `npm run test:integration` |
| NFR3 | Backend | `api-readiness.test.js` | no update/delete audit route; append-only | `npm test` |
| NFR4 | Backend | `api-readiness.test.js` | authz, project scope, input caps, no file contents in errors | `npm test` |
| NFR5 | CI | coverage | backend/frontend ≥ 60% | `npm run test:coverage`, `npm test -- --run --coverage` |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] `READINESS_GATE_MODE` defaults to `warn`; `off` is a clean bypass
- [ ] The five paths share one assertion; no side door
- [ ] Blocked audit rows are emitted outside the transaction
- [ ] Actor rows use `runtime_id`/`node_id`, never the dropped `agents` table
- [ ] Existing tickets are grandfathered
- [ ] No secret or file content in errors
- [ ] `04` matches what was built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run (planned) |
