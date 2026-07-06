# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: completed
**Date created**: 2026-06-19
**Date completed**: 2026-07-06
**Author**: AI Assistant
**Scope**: Frontend

> **NOTE**: Implementation is already complete. All code changes exist in HEAD. This document is preserved for historical reference only. + Backend
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

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/ticketPlanning.js` | MODIFY | Update OpenAPI spec enum: `[architect]` → `[architecture, technical, simple]` |
| `backend/src/controllers/ticketPlanningController.js` | MODIFY | Update template mapping: replace `'architect'` with three template entries |
| `frontend/src/views/TicketDetail.vue` | MODIFY (verify) | Template options already correct — verify no changes needed |
| `database` | NONE | No schema changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Existing `'architect'` references]**: Other code may reference `'architect'` (tests, other controllers). **Resolution**: grep `grep -rn "'architect'" backend/src/` before changing.
2. **[Template file content]**: The `'architect'` template maps to specific file content. **Resolution**: Ensure each of the three new names maps to appropriate content (system design, technical implementation, simple task list).

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
- Changes to the planning file storage mechanism

---

## Performance Considerations

- Expected load: N/A (this is a template name fix, no new queries)
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A

---

## Security Considerations

- Authentication required: YES (existing — planning endpoints are behind auth)
- Authorization check: YES (existing — ticket-level access control)
- Input validation: YES (existing — template name validated against enum)
- Rate limiting: N/A (not a user-facing endpoint)
- Sensitive data handling: No change — planning files contain user content, not secrets

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: test `applyTemplate` with each of the three template names
- [ ] API endpoint tests: test the apply-template endpoint with each template name

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — no regressions
- [ ] Manual verification: apply each template in the UI, verify files are created

### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify apply-template response shape
- [ ] Generated types regenerated: `cd frontend && npm run generate:spec && npm run generate:api` (after backend OpenAPI spec update)
- [ ] Generated types compile: `cd frontend && npm run typecheck`

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — both frontend and backend lint pass
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Only fixing the frontend** — the backend enum would still reject the frontend names
- ❌ **Only fixing the backend enum** — the controller's template mapping logic also needs updating
- ❌ **Hardcoding template names** — use a configuration object for template-to-content mapping
