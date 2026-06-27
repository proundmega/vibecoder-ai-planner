# bp-26: Add Phase Column + PhaseService — Ticket Phase Machine

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend
**Priority**: P0
**Effort**: Medium

## Problem Statement

The kanban board currently uses 4 statuses (`backlog → in_progress → review → done`) with no sequential flow enforcement. There is no phase machine — a ticket can go from backlog to done without planning, approval, or assignment. The DREAM vision replaces this with a guided phase progression: draft → planning → plan_approved → assigned → in_progress → review → human_approval → done → deployed.

## Scope

- **In scope**: New `phase` column on tickets, PhaseService with transition validation, allowed transitions map, migration
- **Out of scope**: UI changes (PhaseFlow.vue), planning gate enforcement (bp-27), feedback (bp-28)

## Acceptance Criteria

- [ ] Migration adds `phase` column (enum) to tickets table with default `draft`
- [ ] Existing `status` column remains for backward compatibility
- [ ] PhaseService validates transitions: each phase has defined allowed next phases
- [ ] PhaseService.transition() throws on invalid transitions with message showing allowed phases
- [ ] PhaseService.getCurrentPhase(ticketId) returns current phase
- [ ] PhaseService.getAllowedNextPhases(ticketId) returns list of valid target phases
- [ ] PhaseService.getPhaseHistory(ticketId) returns phase transition log
- [ ] New `ticket_phases` table logs every transition (ticket_id, from_phase, to_phase, actor, timestamp)

## Known Unknowns

- **Backward compatibility**: Existing tickets have no `phase`. They should get a computed default based on `status`.

## Decisions Required

1. **How to handle existing tickets?**
   - Option A: All existing tickets get `phase = 'draft'` (simple, but may lose context)
   - Option B: Map existing status to phase: backlog→draft, in_progress→in_progress, review→review, done→done
   - **Recommendation**: Option B — smarter mapping preserves existing workflow state

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/models/ticket.js` | MODIFY | Add phase field to fromRow(), create(), update() |
| `backend/src/services/PhaseService.js` | CREATE | Transition validation + logging |
| `backend/src/services/TicketService.js` | MODIFY | Add phase transition on status change |
| `backend/src/migrations/018_ticket_phases.sql` | CREATE | Add phase column, create ticket_phases log table |
| `backend/src/api/tickets.js` | MODIFY | Add phase-related endpoints |
| `backend/src/api/v1/index.js` | MODIFY | Mount tickets/phase routes |

## Dependencies

- **Depends on this**: bp-27 (planning gate), bp-28 (feedback), bp-30 (diagnostics tests phase)
