# 03 — Implementation (fg-45)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Define the Definition of Ready (DoR) and the small-fix exemption
- [x] Enumerate every path into `in_progress` (pickup, status route, PUT, phase transitions, planning status)
- [x] Centralize `assertReadyForExecution` and call it from all five paths
- [x] Keep ticket creation permissive: title-only tickets are drafts
- [x] Reject `planning_status=completed` outside the readiness service; reject transitions out of `completed` (`REPLAN_REQUIRED`) and add the audited `replan` path
- [x] Add `ticket_acceptance_criteria` and per-template `requiredSections`
- [x] Add readiness columns (`plan_approved_*`, `ready_*`, `small_fix_*`, waiver fields, grandfathered)
- [x] Add issue codes and `ReadinessError` (409 `READINESS_FAILED` with `details.issues`)
- [x] Honor `READINESS_GATE_MODE=off|warn|enforce` (default `warn`) in the assertion
- [x] Refresh `ready_at` on every readiness-relevant write and on waiver expiry
- [x] Extend the Java error model and handle readiness in the harness processor
- [x] Add `TICKET_READINESS_APPROVE`/`TICKET_READINESS_OVERRIDE` permissions with project membership
- [x] Add `assertProjectMember` (owner, `project_memberships`, agent owner, `super_admin` bypass)
- [x] Add `ticket_readiness_events` audit with `actor_type`/agent IDs, out-of-band blocked rows, and revocation/expiry events (do not depend on the missing `audit_log`)
- [x] Scope overrides to waived codes + expiry; keep small-fix separate
- [x] Backfill/grandfather existing tickets (approval + ready + completed)
- [x] Propagate readiness errors in `frontend/src/api/tickets.ts`
- [x] Add the ticket creation wizard fields and readiness panel
- [x] Add readiness metrics and blocked-ticket messages
- [x] Add assumptions and change impact to the `01` templates and the lightweight `00` (root, product)
- [x] Add failure modes and security considerations to the `02` templates (root, product)
- [x] Parse and validate the risk sections; add the new issue codes and security-sensitive scope detection
- [x] Export the parsed requirement IDs for `fg-51`
- [x] Add tests for every write path, agent handling, override, risk sections and UI

## Per-file changes

| File | Action | Change |
|---|---|---|
| `backend/src/migrations/061_ticket_readiness.sql` | CREATE | Columns, criteria/event tables, permissions, grandfather backfill |
| `backend/src/migrations/061_ticket_readiness_rollback.sql` | CREATE | Drop tables/columns/permissions child-first |
| `backend/src/migrations/apply.js` | MODIFY | Register 061 after 060 |
| `backend/src/errors/HttpError.js` | MODIFY | `ReadinessError` (409) and `PlanningStatusError` |
| `backend/src/services/ProjectAccessService.js` | CREATE | Owner/member check + super_admin bypass |
| `backend/src/services/ReadinessEvaluator.js` | CREATE | Deterministic issue codes, risk sections, requirement IDs |
| `backend/src/services/TicketReadinessService.js` | CREATE | Gate modes, approval lifecycle, overrides, criteria, sweep |
| `backend/src/services/ReadinessMetrics.js` | CREATE | In-process counters |
| `backend/src/controllers/ticketReadinessController.js` | CREATE | Readiness/criteria endpoints |
| `backend/src/services/TicketService.js` | MODIFY | Gate pickup, `updateStatus`, `update`; refresh on content edits; permissive create |
| `backend/src/services/PhaseService.js` | MODIFY | Gate target phases mapping to `in_progress` |
| `backend/src/services/TicketPlanningService.js` | MODIFY | Completed guard, sticky completed, criteria seed, refresh |
| `backend/src/services/TemplateService.js` | MODIFY | `requiredSections`, `getTemplateDefinition`, risk sections |
| `backend/src/validators/tickets.js` | MODIFY | Create/override/small-fix/criteria schemas |
| `backend/src/validators/pathParams.js` | MODIFY | `criterionId` UUID |
| `backend/src/api/tickets.js` | MODIFY | Readiness and criteria routes + OpenAPI |
| `backend/src/api/v1/index.js` | MODIFY | Planning status route gains `TICKET_UPDATE` |
| `backend/src/index.js` | MODIFY | Waiver expiry sweep |
| `agent/src/main/java/com/vibecode/agent/model/ApiResponse.java` | MODIFY | `details` on `Error` |
| `agent/src/main/java/com/vibecode/agent/service/ReadinessException.java` | CREATE | Structured readiness error |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | Throw `ReadinessException` on pickup/status |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | MODIFY | Post issues, start no harness |
| `frontend/src/api/tickets.ts` | MODIFY | Readiness/criteria clients, error propagation |
| `frontend/src/components/ReadinessIssues.vue` | CREATE | Shared issue renderer |
| `frontend/src/components/ReadinessPanel.vue` | CREATE | Badge, issues, approve/small-fix/override/replan |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Panel, planning status guard, readiness refresh |
| `frontend/src/views/TicketBoard.vue` | MODIFY | Wizard fields, drag restore, issue surface |

## Dependencies

- fg-30.
- The fg-31 reviewer integration is narrowed out of this ticket and tracked as D2;
  the pilot uses human review, so fg-45 does not wait for fg-31.
- fg-50 owns the repo/product template drift test that keeps the risk sections
  aligned (D7).
- `fg-51` consumes the requirement IDs exported by this ticket; do not duplicate traceability here

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Backend unit | `backend/src/__tests__/ticketReadinessCreate.test.js` | Title-only create stays a draft; optional criteria/template/small-fix seed state | `cd backend && npm test -- ticketReadinessCreate` |
| FR2 | Backend unit | `backend/src/__tests__/ticketReadinessCreate.test.js` | Criteria are inserted before a template seed | `cd backend && npm test -- ticketReadinessCreate` |
| FR3 | Backend unit | `backend/src/__tests__/ticketReadinessService.test.js` | `evaluate` returns ready, issues, template, waived codes and expiry | `cd backend && npm test -- ticketReadinessService` |
| FR4 | Backend unit | `backend/src/__tests__/ticketReadinessGates.test.js` | Pickup surfaces `READINESS_FAILED` (409) with issues | `cd backend && npm test -- ticketReadinessGates` |
| FR5 | Backend unit | `backend/src/__tests__/ticketReadinessGates.test.js`, `ticketReadinessBacklog.test.js` | Pickup, status, PUT, phase transition gated; content is written before the gate; enforce filters unready backlog tickets | `cd backend && npm test -- ticketReadiness` |
| FR6 | Backend unit | `backend/src/__tests__/ticketPlanningStatusGuard.test.js` | `completed` rejected; leaving completed requires replan; authoring states update | `cd backend && npm test -- ticketPlanningStatusGuard` |
| FR7 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | `PLACEHOLDER` carries the file/marker | `cd backend && npm test -- readinessEvaluator` |
| FR8 | Backend unit | `backend/src/__tests__/ticketReadinessService.test.js` | Override validation, expiry cap and audit dedupe | `cd backend && npm test -- ticketReadinessService` |
| FR9 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | Small fix waives template/file/test/deps/rollback but checks criteria/assumptions | `cd backend && npm test -- readinessEvaluator` |
| FR10 | Agent unit | `agent/src/test/java/com/vibecode/agent/harness/HarnessTicketProcessorTest.java` | Readiness failure posts issues and starts no harness | `cd agent && mvn test -Dtest=HarnessTicketProcessorTest` |
| FR11 | Frontend unit | `frontend/src/__tests__/readiness.test.ts`, `ticketBoardCreateFlow.test.js` | Panel renders issues; create errors surface; drag path restores | `cd frontend && npm test -- --run readiness ticketBoardCreateFlow` |
| FR12 | Integration | `backend/src/__tests__/integration/ticketReadinessMigration.test.js` | Runs the real 061 file; grandfathers `in_progress`/`review`/`done`, leaves drafts alone | `cd backend && npm run test:integration` |
| FR13 | Backend unit | `backend/src/__tests__/readinessMetrics.test.js` | Ready/blocked/evaluated counters, pickup rejections, waiver counts, time-to-ready observation | `cd backend && npm test -- readinessMetrics` |
| FR14 | Backend unit | `backend/src/__tests__/ticketReadinessService.test.js` | Approved/invalidated/blocked, override granted/revoked/expired events; blocked dedupes on `attempt_id` | `cd backend && npm test -- ticketReadinessService` |
| FR15 | Backend unit | `backend/src/__tests__/ticketReadinessService.test.js`, `ticketReadinessController.test.js` | Approval, small-fix, replan, override and acceptance-criteria writes require project membership; `canEditCriteria` matches the super_admin bypass | `cd backend && npm test -- ticketReadiness` |
| FR16 | Backend unit | `backend/src/__tests__/ticketReadinessService.test.js` | Passing edit keeps approval; failing edit clears approval and writes `approval_invalidated` | `cd backend && npm test -- ticketReadinessService` |
| FR17 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | Missing/empty assumptions fail; explicit "No material assumptions" passes | `cd backend && npm test -- readinessEvaluator` |
| FR18 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | Missing/empty failure modes fail for non-small templates | `cd backend && npm test -- readinessEvaluator` |
| FR19 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | Missing security section fails; security-sensitive issue is non-waivable, including for a small fix | `cd backend && npm test -- readinessEvaluator` |
| FR20 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | Missing/empty change impact fails | `cd backend && npm test -- readinessEvaluator` |
| FR21 | Backend unit | `backend/src/__tests__/readinessEvaluator.test.js` | Requirement IDs are unique, parsed and changing an approved ID requires replan | `cd backend && npm test -- readinessEvaluator` |

## Review checklist

- [x] Every `FR*`/`NFR*` has a passing row in the matrix
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration has a rollback and is registered in `apply.js`
- [x] API contract matches `02`; OpenAPI/types regenerated if it changed
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [x] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | e59da23 | backend unit + integration, agent unit, frontend unit + typecheck + lint, planning check | pass |
| 2026-11-22 | ab1d85a | review fixes: queue filter, content-before-gate, create small-fix permission, criteria scoping, requirement parsing, docs/indexes, regenerated OpenAPI/types | pass |
| 2026-11-22 | 052f0cc | review fixes 2: scoped create options validated before insert, actor role through criteria/template seed, criteria UI capability, membership/event tests, docs drift | pass |
| 2026-11-22 | b39c020 | review fixes 3: super_admin canEditCriteria, template application keeps route policy, best-effort criteria seed, agent-path test, FR15 wording | pass |
| 2026-11-22 | 36abbc2 | review fixes 4: total seed-error handling, create compensation delete, rebased onto master (19cfc33) | pass |
| 2026-11-22 | f2aa8bc | Cypress create-wizard description selector updated for the readiness wizard | pass |
| 2026-11-22 | `2839ae2` | Merged (PR #199) | Merged to master after review; readiness gate defaults to `warn`. |
