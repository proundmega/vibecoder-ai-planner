# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: 2026-06-19
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend + Backend
**Priority**: P1
**Effort**: Small

---

## Requirement

Fix the template name mismatch between the Ticket Planning UI and the backend API. The frontend offers templates `['architecture', 'technical', 'simple']` but the backend expects `'architect'` (per the OpenAPI spec enum at `ticketPlanning.js:102`).

**Current behavior**: Selecting a template in the UI sends a name the backend doesn't recognize, causing a 400 error.
**Expected behavior**: Template names match between frontend and backend.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/ticketPlanning.js` — YES (inlined in `v1/index.js:43`)
- [x] Controller exists: `backend/src/controllers/ticketPlanningController.js` — YES
- [x] OpenAPI spec enum at `ticketPlanning.js:102`: `enum: [architect]`

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/ticketPlanning.js` — YES
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/TicketDetail.vue` — YES (planning section)
- [x] Existing section where this feature lives — YES (planning section at line ~384)
- [x] Template options at line 435: `['architecture', 'technical', 'simple']`

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES (paths are correct)
- [ ] Response shapes match — NO (template names don't match)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **BOTH frontend and backend fix**. The backend only defines `'architect'` as a valid template name, but the frontend offers three options: `'architecture'`, `'technical'`, `'simple'`. 

**Two approaches**:
1. **Backend fix**: Add the missing template names (`'architecture'`, `'technical'`, `'simple'`) to the backend's allowed templates
2. **Frontend fix**: Change the frontend options to match the backend (`'architect'`)

**Recommendation**: Fix the backend to support the frontend's template names. The frontend's names are more descriptive and user-friendly. The backend should accept all three names.

---

## Scope

### In Scope
- [ ] Update `backend/src/api/ticketPlanning.js` — add `'architecture'`, `'technical'`, `'simple'` to the allowed templates
- [ ] Update `backend/src/controllers/ticketPlanningController.js` — handle the new template names
- [ ] Update `backend/src/api/ticketPlanning.js` OpenAPI spec — update enum to include all three names
- [ ] Update `frontend/src/views/TicketDetail.vue` — verify template names match (may need no change if backend is fixed)

### Out of Scope
- Creating new template types beyond the three defined
- Template file content changes (just the template name mapping)
- New API endpoints

---

## Important Design Decisions

**DECISION POINTS**:

1. **Which side to fix?**
   - A) Backend: add the three frontend template names → backend accepts `'architecture'`, `'technical'`, `'simple'`
   - B) Frontend: change to match backend → frontend offers only `'architect'`
   
   **Recommendation**: Option A — the frontend names are more descriptive and user-friendly. Fix the backend to accept them.

2. **How to map template names to file content?**
   - Each template name should map to a different set of planning files
   - `'architecture'` → system design sections
   - `'technical'` → implementation steps
   - `'simple'` → basic task list
   
   **Recommendation**: Implement mapping in the controller's `applyTemplate` function.

---

## Acceptance Criteria

1. [ ] [Backend API] `POST /api/v1/tickets/:ticketId/planning/apply-template` accepts `templateName: 'architecture'`
2. [ ] [Backend API] `POST /api/v1/tickets/:ticketId/planning/apply-template` accepts `templateName: 'technical'`
3. [ ] [Backend API] `POST /api/v1/tickets/:ticketId/planning/apply-template` accepts `templateName: 'simple'`
4. [ ] [Backend API] OpenAPI spec enum includes all three template names
5. [ ] [Frontend UI] Selecting a template in TicketDetail.vue sends the correct name to the backend
6. [ ] [Frontend UI] Template application succeeds without 400 errors
7. [ ] [Both] All tests pass
8. [ ] [Both] Linting passes
9. [ ] [Both] Frontend typecheck passes

---

## Out of Scope

- Adding more template types beyond the three defined
- Template file content customization by users
- Backend changes to the planning file structure

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: test `applyTemplate` with each of the three template names
- [ ] API endpoint tests: test the apply-template endpoint with each template name

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — no regressions
- [ ] Manual verification: apply each template in the UI, verify files are created

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — both frontend and backend lint pass
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Only fixing the frontend** — the backend enum would still reject the frontend names
- ❌ **Only fixing the backend enum** — the controller's template mapping logic also needs updating
- ❌ **Hardcoding template names** — use a configuration object for template-to-content mapping
