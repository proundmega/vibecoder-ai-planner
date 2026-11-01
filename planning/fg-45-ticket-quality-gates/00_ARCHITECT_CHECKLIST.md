# 00_ARCHITECT_CHECKLIST.md - Ticket Quality Gates and Definition of Ready (fg-45)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-30 (agent execution), fg-31/32 (review loop)
**Related code:** `validators/tickets.js`, `TemplateService`, `TicketPlanningService`, `PhaseService`, `TicketService`, `models/ticket.js`, `middleware/permissions.js`, `agent/harness/HarnessTicketProcessor.java`, `agent/service/TicketProcessor.java`, `TicketBoard.vue`, `TicketDetail.vue`, `frontend/src/api/tickets.ts`

## Why this ticket exists

Planning templates exist, but nothing enforces them. A ticket can be created with only a title, picked up by an agent, and implemented without scope, acceptance criteria, plan or tests. The existing planning gate (`PhaseService.getGateStatus`) is only used by tests. Five separate paths move a ticket into execution and none of them checks readiness.

## Checklist

- [ ] Define the Definition of Ready (DoR) and the small-fix exemption
- [ ] Enumerate every path into `in_progress` (pickup, status route, PUT, phase transitions, planning status)
- [ ] Centralize `assertReadyForExecution` and call it from all five paths
- [ ] Keep ticket creation permissive: title-only tickets are drafts
- [ ] Reject `planning_status=completed` outside the readiness service
- [ ] Add `ticket_acceptance_criteria` and per-template `requiredSections`
- [ ] Add readiness columns (`plan_approved_*`, `ready_*`, `small_fix_*`, waiver fields, grandfathered)
- [ ] Add issue codes and `ReadinessError` (409 `READINESS_FAILED` with `details.issues`)
- [ ] Extend the Java error model and handle readiness in both processors
- [ ] Add `TICKET_READINESS_APPROVE`/`TICKET_READINESS_OVERRIDE` permissions with project membership
- [ ] Add `ticket_readiness_events` audit (do not depend on the missing `audit_log`)
- [ ] Scope overrides to waived codes + expiry; keep small-fix separate
- [ ] Backfill/grandfather existing tickets (approval + ready + completed)
- [ ] Propagate readiness errors in `frontend/src/api/tickets.ts`
- [ ] Add the ticket creation wizard and readiness panel
- [ ] Add readiness metrics and blocked-ticket messages
- [ ] Add tests for every write path, both agent modes, override and UI

## Important design decisions

1. Gate at execution boundaries; drafts stay cheap.
2. One assertion in the service layer, not per-route checks.
3. `plan_approved_at` is the approval fact; `planning_status=completed` mirrors it.
4. `ready_at` is only set after validation; an override is a scoped waiver, not “ready”.
5. Small-fix exemption ≠ override.
6. Readiness is recomputed on read; stale `completed` never grants access.

## Known unknowns

- Minimum description length (proposal 80 characters).
- Whether `member` should hold the override permission (Phase 1: no).
- Whether custom templates must declare `requiredSections` (Phase 1: optional, warn).
- Whether acceptance criteria should also parse `04_SPECIFICATION.md` (Phase 1: table is authoritative).

## Testing checklist

- [ ] Evaluator unit tests for all issue codes.
- [ ] Gate tests for pickup, `POST /status`, `PUT /tickets/:id`, phase transitions, planning status.
- [ ] `approve-plan` transactional tests (no partial completion).
- [ ] Override permission/scope/expiry tests.
- [ ] Java processor tests for both legacy and harness modes.
- [ ] Backfill/grandfather migration test.
- [ ] Frontend error propagation + readiness panel test.
