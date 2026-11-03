# 03 — Implementation (bp-124)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Triage O1-O8 and assign priorities/owners
- [x] Create per-defect planning suites when scheduled (folded into bp-124 slices; see `00`)
- [x] Fix O1 milestone field persistence
- [x] Fix O2 dead SQL / missing tables
- [ ] Rewrite and wire Cypress E2E (O3)
- [ ] Reconcile agent identity semantics (O4)
- [x] Migrate frontend validator to camelCase (O5)
- [x] Fix `PUT /tickets/:id` response type (O6)
- [x] Finish docs drift cleanup (O7) — README CI/migration counts, planning queue
- [x] Make integration setup fail on migration errors (O8)
- [ ] Add EditTicketModal/TicketDetail component tests and refresh assignment E2E (O9)
- [x] Decide on full SQL grammar validation for dry-run (O10) — documented as structural-only
- [ ] Move completed planning suites to `planning/DONE/` (FR11)

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/models/ticket.js` | modify | Map `milestoneId`/`estimate`/`dependsOn`; persist them in `UPDATE`; `RETURNING *` and return the ticket; delete `deleteWithAudit` |
| `backend/src/services/TicketService.js` | modify | Validate camelCase milestone fields (snake_case aliases kept), pass them to the model, return the ticket; delete `updateMilestoneFields` and `getAgentTickets`; fix `dependsOn` in dependency checks |
| `backend/src/controllers/ticketController.js` | modify | Allow `milestoneId`/`estimate`/`dependsOn`; respond with the updated ticket |
| `backend/src/validators/tickets.js` | modify | Joi rules for `milestoneId`, `estimate`, `dependsOn` |
| `backend/src/models/user.js`, `project.js` | modify | Delete `deleteWithAudit` (missing `audit_log`) |
| `backend/src/services/AgentService.js` | modify | Delete `getAgentTickets` (missing `project_agents`) |
| `backend/src/__tests__/integration/migrationSupport.js` | add | Extracted splitter/runner; unexpected errors throw |
| `backend/src/__tests__/integration/setup.js` | modify | Use the shared runner so migrations fail the run |
| `frontend/src/api/validator.ts` | modify | Project/Ticket → camelCase numeric-string ids; Agent matches snake_case DB rows; primitive type enforcement |
| `frontend/src/api/tickets.ts` | modify | Add `milestoneId`/`estimate`/`dependsOn` to the `Ticket` type |
| `frontend/src/__tests__/api-contract.test.ts` | modify | Fixtures use BIGSERIAL numeric strings; milestone fields + `dependsOn` string[] tests; snake_case rejection test |
| `frontend/src/__tests__/tickets.test.js` | modify | UI contract: `updateTicket` forwards milestone fields |
| `backend/src/__tests__/openapiTicketContract.test.js` | add | OpenAPI guard: `dependsOn` string[], BIGSERIAL ids are `NumericId` |
| `backend/src/__tests__/integration/ticketMilestoneContract.test.js` | add | Real DB/API: PUT persists milestone fields; GET returns `dependsOn` as string[] |
| `backend/src/__tests__/migrationSupport.test.js` | add | O8 regression tests |
| `backend/src/__tests__/ticketMilestoneFields.test.js` | add | O1 service regression tests |
| `backend/src/__tests__/ticketModelMilestone.test.js` | add | O1/O6 model regression tests |
| `backend/src/__tests__/noMissingTableReferences.test.js` | add | O2 guard against missing-table SQL |
| `backend/src/__tests__/api-ticket-put.test.js` | modify | O1/O6 route regression tests |
| `backend/src/__tests__/ticketController.test.js`, `ticketModelRegressions.test.js`, `agentService.test.js`, `ticket_ownership*.test.js` | modify | Align with the new return value and removed methods |
| `README.md` | modify | Jenkins CI section, migration count, `PENDING.txt` reference |

## Dependencies

- bp-123

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend service | `src/__tests__/ticketMilestoneFields.test.js` | persists `milestoneId`/`estimate`/`dependsOn`; clears with null; rejects foreign milestone, bad estimate, cycle | `npm test` |
| FR1 | Backend model | `src/__tests__/ticketModelMilestone.test.js` | SET clause + `RETURNING *` + model mapping | `npm test` |
| FR1 | Backend route | `src/__tests__/api-ticket-put.test.js` | accepts milestone fields; rejects estimate 0 | `npm test` |
| FR1 | Backend integration | `src/__tests__/integration/ticketMilestoneContract.test.js` | real DB/API: PUT persists `dependsOn`/`estimate`; GET returns `dependsOn` as string[] | `npm run test:integration` |
| FR1 | OpenAPI contract | `src/__tests__/openapiTicketContract.test.js` | `dependsOn.items` is string; BIGSERIAL ids use `NumericId`; `milestoneId` stays uuid | `npm test` |
| FR2 | Backend guard | `src/__tests__/noMissingTableReferences.test.js` | no `project_agents`/`audit_log` references in `src/` | `npm test` |
| FR3 | — | — | not started (O3) | — |
| FR4 | — | — | not started (O4) | — |
| FR5 | Frontend contract | `src/__tests__/api-contract.test.ts` | camelCase Project/Ticket accepted; `owner_id` rejected; numeric-string ids; `dependsOn` string[] enforced | `npm test -- --run` |
| FR5 | Frontend UI contract | `src/__tests__/tickets.test.js` | `updateTicket` forwards `milestoneId`/`estimate`/`dependsOn` | `npm test -- --run` |
| FR6 | Backend route | `src/__tests__/api-ticket-put.test.js` | response `data` is the updated ticket, no `message` | `npm test` |
| FR7 | Docs | — | README matches Jenkins, 46 migrations, `PENDING.txt` | manual |
| FR8 | Integration bootstrap | `src/__tests__/migrationSupport.test.js` | unexpected error throws; idempotent errors ignored | `npm test` |
| FR9 | — | — | not started (O9) | — |
| FR10 | Docs | — | dry-run documented as structural-only in `02`/`03` | manual |
| FR11 | — | — | not started (DONE moves) | — |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-03 | `e43c2b1` + `8e27c2a` (PR #116) | O1, O2, O5, O6, O8 (+ O7/O10 docs) | Backend 119 suites / 1505 tests pass; frontend 60 files / 552 tests pass; typecheck clean; lint 0 errors (31 pre-existing warnings); OpenAPI regenerated |
