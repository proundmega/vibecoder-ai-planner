# bp-32: PhaseFlow.vue — Guided Phase UI

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Frontend
**Priority**: P1
**Effort**: Large

## Problem Statement

bp-26 built the backend phase machine (column + transition validation), but the UI remains a flat kanban board (`TicketBoard.vue`). Users interact with all tickets in 4 columns regardless of their phase. For the workflow to work end-to-end, each phase needs a dedicated screen with phase-specific UI: template selector for `planning`, agent selector for `assigned`, status feed for `in_progress`, Q&A for `blocked`, diff viewer for `review`, summary for `human_approval`, deploy for `done`, and deployment info for `deployed`. Without these screens, the phase machine has no usable frontend.

## Scope

### In Scope

- New route `/projects/:id/tickets/:id/flow` with `PhaseFlow.vue` component
- 10 phase screens: draft, planning, plan_approved, assigned, in_progress, blocked, review, human_approval, done, deployed
- "Compact view" toggle that navigates to the existing `TicketBoard.vue`
- New API client: `frontend/src/api/phases.js`
- Modify `router/index.ts` to add the `/flow` route
- Modify `TicketDetail.vue` to add "Open Guided Flow" button
- Each phase screen uses existing Vue 3 patterns (`<script setup>`, `@` alias imports, scoped CSS)
- Responsive layout matching existing view styles

### Out of Scope

- Diff viewer implementation (bp-34/bp-35 separate tickets) — review phase will show a placeholder
- Deploy button backend (bp-37) — done phase will show a placeholder button
- Agent selector real-time load data (bp-33 provides this) — assigned phase uses stub data
- Snapshot testing or Cypress component tests (basic unit tests only)
- Backend changes to phase machine

## Acceptance Criteria

- [ ] `GET /projects/:id/tickets/:id/flow` navigates to `PhaseFlow.vue` with the correct ticket
- [ ] Component loads ticket phases from `GET /tickets/:id/phases` (PhaseService from bp-26)
- [ ] Draft phase shows a create/edit form (title, description, priority)
- [ ] Planning phase shows template selector + planning doc fill area
- [ ] Plan_approved phase shows read-only plan view with approve/reject buttons
- [ ] Assigned phase shows agent selector with available agents
- [ ] In_progress phase shows real-time status feed with Feedback tab
- [ ] Blocked phase shows agent question + human reply form
- [ ] Review phase shows diff viewer placeholder + comment stub + approve/request changes
- [ ] Human_approval phase shows summary of changes + approve/reject
- [ ] Done phase shows "Deploy to [environment]" placeholder button
- [ ] Deployed phase shows deployment info with (mock) rollback button
- [ ] "Compact view" toggle navigates to `TicketBoard.vue` with current project
- [ ] Phase transitions via `POST /tickets/:id/phases/transition` on approve/next
- [ ] "Open Guided Flow" button appears in `TicketDetail.vue`
- [ ] API client `frontend/src/api/phases.js` has `fetchPhases()` and `transitionPhase()` calls

## Known Unknowns

- **Phase machine API shape**: The exact response format from bp-26's `GET /tickets/:id/phases` is not finalized. We assume `{ currentPhase, availableTransitions, phases: [{ name, data }] }`. May need adjustment when bp-26 is implemented.
- **Template selector integration**: The form values from template selection flow need to be sent to a planning docs endpoint. The exact endpoint depends on how bp-26 stores planning data.
- **Agent selector data**: Real agent load/status data requires bp-33 heartbeat. For now, assigned phase uses a hardcoded agent list from `/api/agents`.

## Decisions Required

1. **Single component vs. sub-components per phase?**
   - Option A: Single `PhaseFlow.vue` with inline `<template v-if>` for each phase
   - Option B: Separate component per phase (e.g., `PhaseDraft.vue`, `PhasePlanning.vue`) imported into `PhaseFlow.vue`
   - **Recommendation**: Option B — keeps each phase screen manageable. Import via dynamic components: `<component :is="currentPhaseComponent" />`.

2. **State management for phase screens?**
   - Option A: Pinia store for PhaseFlow state
   - Option B: Local refs in PhaseFlow.vue, props to child components
   - **Recommendation**: Option B — phase state is local to a single ticket flow session. Pinia is overkill.

3. **How to handle the compact view toggle?**
   - Option A: Navigate to `router.push({ name: 'ProjectTickets', params: { id: projectId } })`
   - Option B: Navigate to `router.push({ name: 'TicketDetail', params: { projectId, ticketId } })`
   - **Recommendation**: Option A — TicketBoard is the compact kanban view. The flow screen replaces the detail view, not the board.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/views/PhaseFlow.vue` | CREATE | Main phase flow component (~600 lines, 10 phase screens) |
| `frontend/src/api/phases.js` | CREATE | API calls for phase data and transitions |
| `frontend/src/router/index.ts` | MODIFY | Add `/projects/:id/tickets/:id/flow` route |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Add "Open Guided Flow" button with router-link |
| `TicketBoard.vue` | NO CHANGE | Remains accessible for compact mode |

## Dependencies

- **Depends on**: bp-26 (ticket phase machine backend) — the API endpoints this UI consumes
- **Depends on this**: bp-34, bp-35, bp-37 — will provide real implementations for review/deploy placeholders
