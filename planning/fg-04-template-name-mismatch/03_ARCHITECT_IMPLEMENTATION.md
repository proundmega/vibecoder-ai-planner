# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-04 — Fix ticket planning template name mismatch

**Status**: completed
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: 2026-07-07
**PR**: https://github.com/proundmega/vibecoder-ai-planner/pull/48
**Branch**: fg-04-template-name-mismatch
**Scope**: Backend + Frontend

**Dependencies**: None

---

### a) Purpose

Fix the template name mismatch that prevents users from applying planning templates. The frontend offers `['architecture', 'technical', 'simple']` but the backend only accepts `'architect'`. This causes a 400 error when users try to apply a template.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Update template mapping in service]** — `backend/src/services/TicketPlanningService.js`
   - Line ~82: change `templateName === 'architect'` → `templateName === 'architecture'`
   - *Depends on*: nothing

2. **[Update OpenAPI spec enum]** — `backend/src/api/ticketPlanning.js`
   - Line ~102: change `enum: [architecture, technical, simple]` → `enum: [architecture, technical, simple, specification]`
   - *Depends on*: Step 1

3. **[Add comprehensive test coverage]** — `backend/src/__tests__/ticketPlanning.test.js`
   - Add unit tests for `applyTemplate()` with all 4 built-in templates
   - Add test for custom template fallback
   - Add test for transaction rollback on error
   - Add regression test for 'architecture' vs 'architect' bug
   - *Depends on*: Step 1

4. **[Add route-level supertest]** — `backend/src/__tests__/routeOrdering.test.js`
   - Add test for POST `/api/v1/tickets/1/planning/apply-template`
   - Add test for 400 error without templateName
   - Add test for 'architecture' being accepted (not 'architect')
   - *Depends on*: Step 1

5. **[Add frontend test]** — `frontend/src/__tests__/ticketPlanning.test.js`
   - Add tests for built-in template names ('architecture', 'technical')
   - *Depends on*: Step 1

6. **[Run verification]** — `cd backend && cd frontend`
   - `cd backend && npm test` — backend tests pass
   - `cd frontend && npm test -- --run` — frontend tests pass
   - *Depends on*: Steps 1-5

---

### c) Per-File Action Plan

#### `backend/src/api/ticketPlanning.js` (MODIFY)
- **Change**: Update OpenAPI spec enum for template names
- **Line ~102**:
  ```javascript
  // Before:
  // enum: [architect]

  // After:
  // enum: [architecture, technical, simple]
  ```
- **Imports needed**: None (existing imports unchanged)

#### `backend/src/controllers/ticketPlanningController.js` (MODIFY)
- **Change**: Update template mapping object
- **Position**: Find the `templates` object (currently has `'architect'` key)
- **Specific changes**:
  ```javascript
  // Before:
  const templates = {
    architect: { /* content */ }
  };

  // After:
  const templates = {
    architecture: {
      // System design template content
      files: { 'ARCHITECTURE.md': '...' }
    },
    technical: {
      // Technical implementation template content
      files: { 'IMPLEMENTATION.md': '...' }
    },
    simple: {
      // Basic task list template content
      files: { 'TASKS.md': '...' }
    }
  };
  ```
- **Imports needed**: None (existing imports unchanged)

#### `frontend/src/views/TicketDetail.vue` (VERIFY)
- **Change**: Verify template options are already correct — likely no changes needed
- **Line 435**: Template options are `['architecture', 'technical', 'simple']` — matches backend
- **Imports needed**: None

---

### d) Dependencies

- None — no external dependencies
- OpenAPI spec regeneration required after backend changes: `cd frontend && npm run generate:spec && npm run generate:api`

---

### e) Risks/Edge Cases

- **[Risk]**: Existing code references `'architect'` elsewhere (tests, other controllers)
  **[Mitigation]**: Run `grep -rn "'architect'" backend/src/` before changing and update all references

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- [x] Test `applyTemplate` with `templateName: 'architecture'` → returns planning files
- [x] Test `applyTemplate` with `templateName: 'technical'` → returns planning files
- [x] Test `applyTemplate` with `templateName: 'simple'` → returns planning files
- [x] Test `applyTemplate` with `templateName: 'specification'` → returns planning files
- [x] Test `applyTemplate` with custom template name → uses fallback
- [x] Test `applyTemplate` with non-existent custom template → throws NotFoundError
- [x] Test `applyTemplate` rollback on error → ROLLBACK called, COMMIT not called
- [x] Regression test: 'architecture' (not 'architect') is the correct name

#### Backend Route Tests (supertest)
- [x] POST `/api/v1/tickets/1/planning/apply-template` with valid template → 200
- [x] POST `/api/v1/tickets/1/planning/apply-template` without templateName → 400
- [x] POST `/api/v1/tickets/1/planning/apply-template` with 'architecture' → 200 (not 'architect')

#### Frontend Unit Tests
- [x] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/ticketPlanning.test.js`
- [x] Tests for built-in template names: 'architecture', 'technical'

---

### g) Migration Notes

Not applicable — no database changes.

---

### h) Files Changed

**Backend:**
```
backend/src/api/ticketPlanning.js                    → MODIFY: update OpenAPI spec enum
backend/src/controllers/ticketPlanningController.js  → MODIFY: update template mapping
```

**Frontend:**
```
frontend/src/views/TicketDetail.vue        → VERIFY: template names already correct (likely no change)
frontend/src/api/generated/                → REGENERATE: types after backend OpenAPI spec update
```

---

### i) Code Review Checklist

- [ ] Backend accepts `'architecture'`, `'technical'`, `'simple'`
- [ ] OpenAPI spec enum updated to `[architecture, technical, simple]`
- [ ] Template mapping in controller has all three templates with appropriate content
- [ ] No references to old `'architect'` name remain (verified via grep)
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] Frontend template names match backend
- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] OpenAPI spec regenerated: `cd frontend && npm run generate:spec && npm run generate:api`
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes (if applicable)
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers apply-template response
- [ ] Bash integration suite test added for apply-template endpoint
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd backend && npm test` passes
2. [ ] `cd frontend && npm test -- --run` passes
3. [ ] `cd backend && npm run lint` passes
4. [ ] `cd frontend && npm run lint` passes
5. [ ] `cd frontend && npm run typecheck` passes
6. [ ] `cd frontend && npm run build` passes
7. [ ] `cd frontend && npm run generate:spec && npm run generate:api` — types regenerated
8. [ ] Apply 'architecture' template → files created
9. [ ] Apply 'technical' template → files created
10. [ ] Apply 'simple' template → files created
11. [ ] Apply 'architect' template → returns 400 (old name no longer valid)
12. [ ] Verify no console errors for template application

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
