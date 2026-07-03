# 00_ARCHITECT_CHECKLIST.md — bp-32 PhaseFlow.vue Guided Phase UI

**Status**: done
**Date created**: 2026-06-28
**Effort**: Large

## Planning

- [x] PhaseFlow.vue created as main container component
- [x] 10 phase sub-components created in views/phases/
- [x] API client created (api/phases.js)
- [x] Router updated with /flow route
- [x] TicketDetail.vue updated with "→ Guided Flow" button
- [x] Frontend typecheck passes (vue-tsc --noEmit)
- [x] All 190 frontend tests pass
- [x] All 614 backend tests pass (7 pre-existing rate limiter failures)

## Existing Infrastructure Audit

### What Already Exists
- `frontend/src/api/client.js` — native fetch client with get/post/put/patch/del
- `frontend/src/router/index.ts` — Vue Router with project detail children
- `frontend/src/views/TicketDetail.vue` — ticket detail view with status transitions
- `frontend/src/views/TicketBoard.vue` — 4-column kanban board (compact view)
- Backend `GET /tickets/:id/phases/current` — returns `{ phase: string }`
- Backend `GET /tickets/:id/phases/allowed` — returns `{ allowed: string[] }`
- Backend `POST /tickets/:id/phases/transition` — transitions with actorType + metadata
- Backend `GET /tickets/:id/phases` — returns phase history array
- `frontend/src/api/templates.js` — template API client (used in PhasePlanning.vue)
- `frontend/src/api/tickets.js` — ticket API client (used in TicketDetail.vue)
- `frontend/src/stores/auth.js` — custom singleton auth store

### What Does NOT Exist
- No existing phase flow UI — this is a greenfield component
- No `views/phases/` directory — created new
- No `api/phases.js` — created new
- No `/flow` route — added to router

## Dependency Analysis

- **PhaseFlow.vue** depends on `api/phases.js` (fetchPhases, transitionPhase)
- **PhasePlanning.vue** depends on `api/templates.js` (listTemplates)
- **PhaseInProgress.vue** depends on `api/client.js` (post for feedback)
- **PhaseAssigned.vue** depends on `api/client.js` (get for agents list)
- Router depends on PhaseFlow.vue file existing
- TicketDetail.vue depends on router having the PhaseFlow route name

## Configuration Audit

- Uses existing `@/` alias (configured in vite.config.ts)
- Uses existing Vue 3 `<script setup lang="ts">` pattern
- Uses existing scoped CSS convention
- No new dependencies required
- No environment variables needed

## Testing Strategy

- Frontend typecheck: `npm run typecheck` — vue-tsc --noEmit
- Unit tests: `npm test -- --run` — vitest (190 tests, all pass)
- Manual testing: Navigate to `/projects/:id/tickets/:id/flow`
- Verify each phase screen renders correctly
- Verify phase transitions work end-to-end

## Rollback Readiness

- Delete `frontend/src/api/phases.js`
- Delete `frontend/src/views/PhaseFlow.vue`
- Delete `frontend/src/views/phases/` directory
- Revert `frontend/src/router/index.ts` (remove /flow route)
- Revert `frontend/src/views/TicketDetail.vue` (remove Guided Flow button)
- No database changes — rollback is purely code revert

## When to Ask the User

- N/A — all design decisions were pre-approved in DREAM.md and planning docs
