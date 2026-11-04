# 03 — Implementation (bp-124)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Triage O1-O8 and assign priorities/owners
- [x] Create per-defect planning suites when scheduled (folded into bp-124 slices; see `00`)
- [x] Fix O1 milestone field persistence
- [x] Fix O2 dead SQL / missing tables
- [ ] Rewrite and wire Cypress E2E (O3)
- [x] Reconcile agent identity semantics (O4)
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
| `backend/src/api/openapi-spec.js` | modify | `dependsOn` string[]; `NumericId` for BIGSERIAL ids; nullable name/description/ownerName |
| `backend/src/api/tickets.js` | modify | PUT body: numeric-string `assigneeId`, `dependsOn` integer-or-string |
| `backend/src/validators/tickets.js` | modify | Joi rules for `milestoneId`, `estimate`, `dependsOn`; `assigneeId` accepts numeric string/number |
| `backend/src/models/user.js`, `project.js` | modify | Delete `deleteWithAudit` (missing `audit_log`) |
| `backend/src/services/AgentService.js` | modify | Delete `getAgentTickets` (missing `project_agents`) |
| `backend/src/__tests__/integration/migrationSupport.js` | add | Extracted splitter/runner; unexpected errors throw |
| `backend/src/__tests__/integration/setup.js` | modify | Use the shared runner so migrations fail the run |
| `frontend/src/api/validator.ts` | modify | Project/Ticket → camelCase numeric-string ids; Agent matches snake_case DB rows; primitive type enforcement + nullable fields |
| `frontend/src/api/tickets.ts` | modify | Add `milestoneId`/`estimate`/`dependsOn`; `description` nullable |
| `frontend/src/api/projects.ts` | modify | camelCase `createdAt`/`updatedAt`, add `ownerId`/`ownerName`, nullable `description` |
| `frontend/src/views/Dashboard.vue`, `ProjectList.vue` | modify | Read `project.createdAt` instead of the never-populated `created_at` |
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
| `backend/src/migrations/048_ticket_assigned_agent_fk.sql` | add | Drop users FK, backfill owner→oldest agent, add `agents(id)` FK `ON DELETE SET NULL` |
| `backend/src/migrations/048_ticket_assigned_agent_fk_rollback.sql` | add | Restore the legacy `users(id)` FK |
| `backend/src/migrations/apply.js` | modify | Register migration 048 |
| `backend/src/controllers/ticketController.js` | modify | Pickup uses `req.agent.id`; JWT callers get 403 |
| `backend/src/services/TicketService.js` | modify | `enforceOwnership` compares agent ids as strings |
| `backend/src/services/HarnessRunService.js` | modify | Start/lease checks compare `assigned_agent_id` to `agents.id` |
| `backend/src/middleware/ticketOwnership.js` | modify | Enforce using the agent id, not the owner user id |
| `backend/src/__tests__/integration/ticketAgentIdentity.test.js` | add | Real DB: FK points at agents, pickup stores agent id, non-agent ids rejected |
| `backend/src/__tests__/ticketAgentIdentityMigration.test.js` | add | Migration registration/rollback guard |
| `README.md`, `AGENTS.md` | modify | Migration count 46 → 47 |

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
| FR4 | Migration / DB | `src/__tests__/integration/ticketAgentIdentity.test.js` | FK references `agents(id)`; pickup stores agent id; non-agent id rejected | `npm run test:integration` |
| FR4 | Backend controller | `src/__tests__/ticket_ownership_controller.test.js` | pickup passes `req.agent.id`; JWT caller gets 403 | `npm test` |
| FR4 | Backend service | `src/__tests__/harnessRunService.test.js` | start/lease checks compare `assigned_agent_id` to `agents.id` | `npm test` |
| FR4 | Migration guard | `src/__tests__/ticketAgentIdentityMigration.test.js` | 048 registered, rollback exists, FK targets agree | `npm test` |
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
| 2026-11-03 | `e43c2b1` + `8e27c2a` + `d49d723b` + `5c96e6d` + `287f4ea` (PR #116) | O1, O2, O5, O6, O8 (+ O7/O10 docs) | Backend 120 suites / 1519 tests pass; frontend 60 files / 562 tests pass; integration 5 suites / 131 tests pass (fresh + re-run); typecheck clean; lint 0 errors (31 pre-existing warnings); OpenAPI regenerated |
| 2026-11-04 | `bdd8dd0` (stacked PR #117) | O4 | Backend 121 suites / 1524 tests pass; frontend 60 files / 562 tests pass; integration 6 suites / 134 tests pass (fresh + re-run); migration 048 backfill and rollback verified against simulated legacy data |
