# 00_ARCHITECT_CHECKLIST.md - Ticket Quality Gates and Definition of Ready (fg-45)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-30 (agent execution), fg-31/32 (review loop)
**Related code:** `validators/tickets.js`, `TemplateService`, `TicketPlanningService`, `PhaseService`, `TicketService.pickUpTicket`, `TicketBoard.vue`, `TicketDetail.vue`

## Why this ticket exists

Planning templates exist, but nothing enforces them. A ticket can be created with only a title, picked up by an agent, and implemented without scope, acceptance criteria, plan or tests. The existing planning gate (`PhaseService.getGateStatus`) is only used by tests.

## Checklist

- [ ] Define the Definition of Ready (DoR) and the small-fix exemption
- [ ] Decide required fields: description length, acceptance criteria, template, scope
- [ ] Add backend readiness evaluation and issue codes
- [ ] Enforce readiness at ticket pickup and `backlog -> in_progress`
- [ ] Add the ticket creation wizard and readiness panel
- [ ] Make `planning_status=completed` derive from validated files, not a free status update
- [ ] Add human override with reason and audit
- [ ] Backfill/grandfather existing tickets
- [ ] Add readiness metrics and blocked-ticket messages
- [ ] Add tests for API, service, gates, UI and override
