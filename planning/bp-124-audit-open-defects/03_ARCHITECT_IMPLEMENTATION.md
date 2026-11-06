# 03 — Implementation (bp-124)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Triage O1-O8 and assign priorities/owners
- [x] Create per-defect planning suites when scheduled (folded into bp-124 slices; see `00`)
- [x] Fix O1 milestone field persistence
- [x] Fix O2 dead SQL / missing tables
- [x] Rewrite and wire Cypress E2E (O3)
- [x] Reconcile agent identity semantics (O4)
- [x] Migrate frontend validator to camelCase (O5)
- [x] Fix `PUT /tickets/:id` response type (O6)
- [x] Finish docs drift cleanup (O7) — README CI/migration counts, planning queue
- [x] Make integration setup fail on migration errors (O8)
- [x] Add EditTicketModal/TicketDetail component tests and refresh assignment E2E (O9)
- [x] Decide on full SQL grammar validation for dry-run (O10) — documented as structural-only
- [x] Move completed planning suites to `planning/DONE/` (FR11)

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/models/ticket.js` | modify | Map `milestoneId`/`estimate`/`dependsOn`; persist them in `UPDATE`; `RETURNING *` and return the ticket; delete `deleteWithAudit` |
| `backend/src/services/TicketService.js` | modify | Validate camelCase milestone fields (snake_case aliases kept), pass them to the model, return the ticket; delete `updateMilestoneFields` and `getAgentTickets`; fix `dependsOn` in dependency checks; `enforceOwnership` compares agent ids as strings |
| `backend/src/controllers/ticketController.js` | modify | Allow `milestoneId`/`estimate`/`dependsOn` and return the updated ticket; pickup uses `req.agent.id`; release checks agent ownership or JWT `PROJECT_UPDATE` |
| `backend/src/api/openapi-spec.js` | modify | `dependsOn` string[]; `NumericId` for BIGSERIAL ids; nullable name/description/ownerName |
| `backend/src/api/tickets.js` | modify | PUT body: numeric-string `assigneeId`, `dependsOn` integer-or-string |
| `backend/src/validators/tickets.js` | modify | Joi rules for `milestoneId`, `estimate`, `dependsOn`; `assigneeId` accepts numeric string/number |
| `backend/src/models/user.js`, `project.js` | modify | Delete `deleteWithAudit` (missing `audit_log`) |
| `backend/src/services/AgentService.js` | modify | Delete `getAgentTickets` (missing `project_agents`) |
| `backend/src/__tests__/integration/migrationSupport.js` | add | Extracted splitter/runner; unexpected errors throw |
| `backend/src/__tests__/integration/setup.js` | modify | Use the shared runner so migrations fail the run |
| `frontend/src/api/validator.ts` | modify | Project/Ticket → camelCase numeric-string ids; Agent matches snake_case DB rows; primitive type enforcement + nullable fields |
| `frontend/src/api/tickets.ts` | modify | Add `milestoneId`/`estimate`/`dependsOn`; `description` nullable |
| `frontend/src/api/projects.ts` | modify | camelCase `createdAt`, add `ownerId`/`ownerName`, nullable `description` |
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
| `backend/src/migrations/048_ticket_assigned_agent_fk.sql` | add | Drop users FK, backfill owner→oldest agent, release unmapped `in_progress` tickets to `backlog`, add `agents(id)` FK `ON DELETE SET NULL`, and a `BEFORE DELETE` trigger that releases an agent's ticket |
| `backend/src/migrations/048_ticket_assigned_agent_fk_rollback.sql` | add | Restore the legacy `users(id)` FK |
| `backend/src/migrations/apply.js` | modify | Register migration 048 |
| `backend/src/services/HarnessRunService.js` | modify | Start/lease checks compare `assigned_agent_id` to `agents.id`; run release requires `assigned_agent_id = run.agent_id` |
| `backend/src/services/HeartbeatService.js` | modify | Pass the stale agent id when releasing its ticket |
| `backend/src/middleware/ticketOwnership.js` | modify | Enforce using the agent id, not the owner user id |
| `backend/src/__tests__/integration/ticketAgentIdentity.test.js` | add | Real DB: FK points at agents, pickup/release identity, agent deletion releases ticket |
| `backend/src/__tests__/integration/ticketAssignedAgentMigration.test.js` | add | Transactional backfill: oldest agent, status reset, idempotent re-run, rollback |
| `backend/src/__tests__/ticketReleaseAuthorization.test.js` | add | Service-level release identity checks |
| `frontend/cypress/support/commands.ts` | modify | `cy.seed`/`cy.login` for `/api/v1`, permission seeding, API fixtures |
| `frontend/cypress/e2e/*.cy.ts` | modify | Rewrite all 7 specs against API-seeded users |
| `frontend/cypress/support/e2e.ts` | modify | Auto-accept `window.confirm` during user deletion |
| `frontend/src/components/TicketEditModal.vue` | modify | `Unassigned` option uses `value=""` so clearing sends `null` |
| `frontend/src/views/TicketDetail.vue` | modify | Refetch the ticket after an assignment change so `assigneeName` updates (D15) |
| `frontend/src/__tests__/ticketEditModal.test.ts` | modify | Assert the `Unassigned` option has an empty value |
| `Jenkinsfile` | modify | `Cypress` stage runs e2e then component tests on the compose network |
| `docker-compose.e2e.yml` | add | Disable rate limiting, allow the `http://frontend` origin, and define the `cypress` build service |
| `frontend/Dockerfile.cypress` | add | Compose-built Cypress runner (full frontend source for component tests) |
| `backend/src/__tests__/ticketAgentIdentityMigration.test.js` | add | Migration registration/rollback guard |
| `backend/src/__tests__/ticket_ownership_controller.test.js` | modify | Pickup/release actor and permission cases |
| `backend/integration-test/suites/ticket_ownership.test.sh`, `agent_lifecycle.test.sh` | modify | Authenticate pickup/release with `X-API-Key`; assert JWT pickup is rejected (O4) |
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
| FR3 | Cypress E2E | `frontend/cypress/e2e/*.cy.ts` | API-seeded auth/projects/tickets/roles/registration/users/assignment | `npm run cypress:e2e` |
| FR3 | CI | `Jenkinsfile` | `Cypress E2E` stage starts the e2e stack and runs the suite | Jenkins |
| FR4 | Migration / DB | `src/__tests__/integration/ticketAgentIdentity.test.js` | FK references `agents(id)`; pickup stores agent id; non-agent id rejected | `npm run test:integration` |
| FR4 | Backend controller | `src/__tests__/ticket_ownership_controller.test.js` | pickup passes `req.agent.id`; JWT caller gets 403 | `npm test` |
| FR4 | Backend service | `src/__tests__/harnessRunService.test.js` | start/lease checks compare `assigned_agent_id` to `agents.id` | `npm test` |
| FR4 | Migration guard | `src/__tests__/ticketAgentIdentityMigration.test.js` | 048 registered, rollback exists, FK targets agree | `npm test` |
| FR4 | Backend service | `src/__tests__/ticketReleaseAuthorization.test.js` | assigned agent releases; another agent rejected; operator path allowed | `npm test` |
| FR4 | Backend controller | `src/__tests__/ticket_ownership_controller.test.js` | release requires agent ownership or JWT `PROJECT_UPDATE` | `npm test` |
| FR4 | Integration / DB | `src/__tests__/integration/ticketAgentIdentity.test.js` | user-role JWT gets 403 on release; deleting an assigned agent returns its `in_progress` ticket to backlog | `npm run test:integration` |
| FR4 | Integration / migration | `src/__tests__/integration/ticketAssignedAgentMigration.test.js` | oldest agent wins; unmapped → backlog/null; review/done preserved; re-run idempotent; rollback restores owner id | `npm run test:integration` |
| FR5 | Frontend contract | `src/__tests__/api-contract.test.ts` | camelCase Project/Ticket accepted; `owner_id` rejected; numeric-string ids; `dependsOn` string[] enforced | `npm test -- --run` |
| FR5 | Frontend UI contract | `src/__tests__/tickets.test.js` | `updateTicket` forwards `milestoneId`/`estimate`/`dependsOn` | `npm test -- --run` |
| FR6 | Backend route | `src/__tests__/api-ticket-put.test.js` | response `data` is the updated ticket, no `message` | `npm test` |
| FR7 | Docs | — | README matches Jenkins, 47 migrations, `PENDING.txt` | manual |
| FR8 | Integration bootstrap | `src/__tests__/migrationSupport.test.js` | unexpected error throws; idempotent errors ignored | `npm test` |
| FR9 | Component | `frontend/cypress/component/EditTicketModal.cy.ts`, `TicketDetail.cy.ts` | limits, priorities, save payload, clear assignee, required title; detail render/actions and D15 assignee refresh | `npm run cypress:component` |
| FR10 | Docs | — | dry-run documented as structural-only in `02`/`03` | manual |
| FR11 | Docs / repo | `planning/DONE/**` | bp-120/bp-121/bp-123/fg-13/fg-14 moved; fg-13 status fixed; placeholders filled | manual + `node planning/check-planning.js` |

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
| 2026-11-06 | PR #117 | O4 integration-test auth | `ticket_ownership` + `agent_lifecycle` bash suites pass (21/21) with agent API keys; JWT pickup returns 403 |
| 2026-11-04 | `78b64b9` (stacked PR #117) | O4 review fixes | Backend 122 suites / 1530 tests pass; frontend 60 files / 562 tests pass; integration 7 suites / 139 tests pass (fresh + re-run); backfill status reset, agent-delete trigger, release authorization, and transactional migration test added |
| 2026-11-05 | `50f9f4e` (stacked PR #118) | O3 | Cypress 7 specs / 37 tests pass against the dev stack; backend 122 suites / 1530 tests; frontend 60 files / 562 tests; integration 7 suites / 139 tests; fixed the `Unassigned` assignee option found by the new E2E |
| 2026-11-05 | `92b85df` (stacked PR #118) | O3 review fixes | E2E overlay allows `http://frontend` (200) and rejects other origins (403); project create asserts the board redirect; assignment asserts without reload after the D15 refetch fix; Cypress 37/37 pass |
| 2026-11-06 | `af7678d` (stacked PR #121) | FR11 | Moved bp-120/bp-121/bp-123/fg-13/fg-14 to `planning/DONE`; fg-13 marked done; placeholders/evidence/results added; 21 → 20 migrated suites (bp-133 added, bp-123 moved to DONE) |
| 2026-11-06 | `4262f14` (stacked PR #119) | O9 review fixes | Component suite 69/69 across 6 consecutive runs with the dev API up; every TicketDetail onMounted request awaited, catch-all API stub and auth reset added |
| 2026-11-06 | `8f746e3` (stacked PR #119) | O9 | Component suite 7 specs / 69 tests (4 EditTicketModal + 3 TicketDetail); E2E 37/37 |
| 2026-11-06 | `f90b177` (stacked PR #118) | O3 Jenkins fix | Replaced the workspace bind mount with a compose-built Cypress image; `docker compose --profile e2e run cypress` passes 37/37 against `http://frontend` |
