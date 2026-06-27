# bp-39: Milestones & Timeline (Phase 13)

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Medium

## Problem Statement

Tickets are an undifferentiated list with no grouping or release planning. There is no concept of "sprint", "release", or "milestone". Teams cannot track progress toward a goal, estimate story points, or express ticket dependencies. Project management features are essential for any collaborative workflow.

## Scope

- **In scope**: Milestones table (one active per project), milestone_id + estimate + depends_on on tickets, CRUD milestones, progress tracking, dependency enforcement, frontend milestone tab in ProjectDetail
- **Out of scope**: Burndown charts, velocity tracking, automated sprint planning, time tracking

## Acceptance Criteria

- [ ] Backend: `GET /api/v1/projects/:id/milestones` lists milestones for project
- [ ] Backend: `POST /api/v1/projects/:id/milestones` creates milestone (deactivates any previously active)
- [ ] Backend: `PUT /api/v1/milestones/:id` updates milestone fields
- [ ] Backend: `GET /api/v1/milestones/:id/tickets` returns tickets in milestone with progress (estimate vs actual)
- [ ] Backend: `GET /api/v1/milestones/:id/progress` returns { totalEstimate, completedEstimate, percentage }
- [ ] Backend: TicketService.enforceDependencies() — ticket can't go to in_progress unless all depends_on are done
- [ ] Frontend: Milestone tab in ProjectDetail.vue with list + create form
- [ ] Frontend: Ticket edit form shows milestone picker and dependency picker
- [ ] Migration 025 creates milestones table
- [ ] Migration 026 adds milestone_id, estimate, depends_on to tickets

## Known Unknowns

- **Dependency cycles**: If ticket A depends on B and B depends on A, the check must detect cycles. Simple depth-first search needed.
- **Estimate units**: Story points vs hours vs t-shirt sizes. We use integer story points for simplicity.
- **Deactivating milestones**: Creating a new milestone deactivates the old one. This is a "rolling milestone" pattern.

## Decisions Required

1. **One active milestone per project?**
   - Option A: Enforce via UNIQUE(project_id, is_active) partial index
   - Option B: Allow multiple active milestones, filter by date
   - **Recommendation**: Option A — simpler, matches the DREAM.md spec. Soft deactivate on create.

2. **Dependency enforcement level?**
   - Option A: Backend-only — TicketService enforces on transition to in_progress
   - Option B: Frontend also shows visual indicator
   - **Recommendation**: Both — backend blocks for correctness, frontend shows for UX

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/025_milestones.sql` | CREATE | Milestones table |
| `backend/src/migrations/026_ticket_milestone_fields.sql` | CREATE | Add milestone_id, estimate, depends_on to tickets |
| `backend/src/services/MilestoneService.js` | CREATE | CRUD, progress calc, ticket listing |
| `backend/src/api/milestones.js` | CREATE | REST routes for milestones |
| `backend/src/api/v1/index.js` | MODIFY | Mount milestones router |
| `backend/src/services/TicketService.js` | MODIFY | Dependency check on transition |
| `frontend/src/api/milestones.js` | CREATE | API client methods |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add milestone tab |
| `frontend/src/views/NewMilestoneModal.vue` | CREATE | Create/edit milestone form |
| `frontend/src/components/MilestoneProgress.vue` | CREATE | Progress bar component |

## Dependencies

- **Depends on**: bp-26 (Phase Machine) — ticket phase transitions need to exist for dependency enforcement

## Performance Considerations

- Milestone progress queries aggregate over all tickets in the milestone. Index on tickets.milestone_id is essential.
- Dependency check is O(n) in the dependency chain depth. For typical use (1-2 levels), no issue.
