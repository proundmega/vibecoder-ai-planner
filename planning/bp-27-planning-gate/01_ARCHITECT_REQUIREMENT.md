# bp-27: Make Planning a Gate — Enforce Planning Before Assignment

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend
**Priority**: P1
**Effort**: Small

## Problem Statement

A ticket can advance from `draft`/`planning` to `plan_approved` even if no planning templates have been filled. The phase machine (bp-26) provides transitions but no enforcement. Agents can pick up unplanned tickets, leading to low-quality output because the AI model has no specification to work from.

## Scope

- **In scope**: Gate check in PhaseService.transition() requiring planning status = 'completed' before `plan_approved`, store planning_gate check in ticket_phases metadata
- **Out of scope**: UI enforcement, feedback UI, agent-side checks

## Acceptance Criteria

- [ ] PhaseService.transition(ticketId, 'plan_approved') checks planning docs exist and planning_status = 'completed'
- [ ] If planning gate fails, PhaseService returns 400 with "Planning not completed" message
- [ ] PhaseService.getGateStatus(ticketId, 'plan_approved') returns { passed: false, reason: '...' }
- [ ] Planning completion is checked via existing TicketPlanningService

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/PhaseService.js` | MODIFY | Add gate check for plan_approved |
| `backend/src/services/TicketPlanningService.js` | NO CHANGE | Already has getPlanningStatus() method |

## Dependencies

- **Depends on**: bp-26 (PhaseService exists)
- **Depends on this**: bp-28 (agent assumes planned tickets)
