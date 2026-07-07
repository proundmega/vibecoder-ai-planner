# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-07
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Small

---

## Requirement

Users cannot create agents because the AgentList page has no "Create Agent" button or modal. The backend API (`POST /api/v1/agents/create`) and frontend API client (`createAgent()`) already exist but are unused. Users see "No agents found." with no way to create one.

This ticket adds a "Create Agent" button and modal to the AgentList page, following the existing `UserModal.vue` pattern.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/agents.js` POST `/agents/create` — **YES** (line 49)
- [x] Controller exists: inline in `agents.js` — **YES**
- [x] Service exists: `backend/src/services/AgentService.create()` — **YES** (line 5)
- [x] Validator exists: `createAgentSchema` (Joi) — **YES** (line 11)
- [x] Route is mounted: `backend/src/api/v1/index.js` line 52 — **YES**
- [x] OpenAPI JSDoc annotations exist — **YES** (line 21)

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/agents.js` — **YES**
- [x] `createAgent()` function exists — **YES** (line 7)
- [x] API client follows existing patterns — **YES** (uses `post` from `./client`)

### Frontend UI Check
- [x] View component exists: `frontend/src/views/AgentList.vue` — **YES**
- [x] Component exists: `frontend/src/components/` — **NO** (no AgentModal.vue)
- [x] Route exists: `frontend/src/router/index.ts` — **YES** (`/agents`, `/agents/:id`)
- [x] Existing modal/pattern to extend — **YES** (`UserModal.vue`)

### Key Insight

**This is a FRONTEND-ONLY task.** The backend API and frontend API client already exist. The only missing piece is the UI: a "Create Agent" button on AgentList and an AgentModal component.

---

## Scope

### In Scope
- Add "Create Agent" button in AgentList.vue header
- Create `AgentModal.vue` component (name input, loading/error states, submit)
- Wire `createAgent()` API call from the modal
- Show success feedback (toast or inline message) after creation
- Refresh agent list after successful creation
- Handle empty state CTA: "No agents yet. Click to create one."

### Out of Scope
- AgentDetail.vue delete/revoke buttons (deferred to future ticket)
- AgentDetail.vue edit name capability (deferred)
- API key masking in list response (backend change, deferred)
- `project_agents` table migration (missing table, deferred)
- AgentList.vue showing CRUD agents table (currently shows heartbeat data only)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/views/AgentList.vue` | MODIFY | Add button, modal binding, createAgent import, refresh logic |
| `frontend/src/components/AgentModal.vue` | CREATE | New modal component following UserModal pattern |
| `frontend/src/api/agents.js` | NONE | `createAgent()` already exists |
| `backend/src/` | NONE | API already exists |
| `database` | NONE | No changes |
| `config` | NONE | No changes |

---

## Known Unknowns

1. **AgentList data source**: Currently shows heartbeat data (`fetchAgentStatusList`). Should the CRUD agents list be shown alongside or instead? → **Decision**: Keep heartbeat data as-is for now. The create button works independently. The CRUD agents list can be added in a future ticket.
2. **Success feedback style**: Toast notification vs inline message? → **Decision**: Inline success message in the empty state area (follows existing patterns).

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

- Modal follows `UserModal.vue` structure (props, emits, CSS classes)
- API key follows the same `post` pattern from `./client`
- Error handling follows `try/catch` with `.catch()` pattern
- Button placement follows `AgentList.vue` existing layout

---

## Acceptance Criteria

1. [ ] [Frontend UI] AgentList.vue shows "Create Agent" button in the header area
2. [ ] [Frontend UI] Clicking "Create Agent" opens a modal with a name input field
3. [ ] [Frontend UI] Modal validates name is 1-100 characters (matches backend Joi schema)
4. [ ] [Frontend UI] Submitting the modal calls `createAgent(name)` API
5. [ ] [Frontend UI] On success: modal closes, user sees confirmation, agent list refreshes
6. [ ] [Frontend UI] On error: modal shows error message inline
7. [ ] [Frontend UI] Empty state shows CTA text: "No agents yet. Click 'Create Agent' to get started."
8. [ ] [Frontend UI] Modal handles loading state (disabled submit button during API call)
9. [ ] [Frontend UI] Modal follows existing CSS patterns (`.modal-overlay`, `.modal`, `.btn-submit`, `.btn-cancel`)
10. [ ] [Frontend UI] Component uses `<script setup>` syntax
11. [ ] [Frontend UI] Loading, error, and empty states tested
12. [ ] [Both] Linting passes (`npm run lint`)
13. [ ] [Both] Typecheck passes (`npm run typecheck`)
14. [ ] [Both] Build passes (`npm run build`)

---

## Out of Scope

- AgentDetail.vue enhancements (delete, revoke, edit)
- API key masking in list response
- Showing CRUD agents table in AgentList.vue
- `project_agents` table migration
- Backend API changes

---

## Performance Considerations

- Expected load: minimal (users create agents infrequently)
- No N+1 queries risk
- No caching needed
- No pagination needed

---

## Security Considerations

- [x] Authentication required: YES — `createAgent` already requires `AGENT_CREATE` permission
- [x] Authorization check: YES — only `super_admin` and `project_admin` can create agents
- [x] Input validation: YES — backend Joi schema (1-100 chars)
- [x] Sensitive data handling: API key is returned at creation time (shown to user once)

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/agents.test.js` — extend with `createAgent()` success/error cases
- [ ] Component tests: `frontend/cypress/component/AgentModal.cy.ts` — CREATED
  - Renders name input
  - Submit calls API with correct body
  - Shows error on API failure
  - Closes on cancel
- [ ] Every new API client function has at least one test case
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ Creating new API clients from scratch — use existing `createAgent()` from `@/api/agents`
- ❌ Ignoring existing modal patterns — follow `UserModal.vue` structure
- ❌ Hardcoding API paths — use the same pattern as existing API clients
- ❌ Skipping error handling — all API calls must use try/catch
- ❌ Testing only happy paths — test error cases, loading states
- ❌ Creating new pages when extending existing is better — add modal to AgentList, don't create new page

---

*Fill in all sections before starting implementation.*
