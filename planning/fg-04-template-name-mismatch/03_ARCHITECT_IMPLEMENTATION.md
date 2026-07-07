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
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend + Frontend

**Dependencies**: None

---

### a) Purpose

Fix the template name mismatch that prevents users from applying planning templates. The frontend offers `['architecture', 'technical', 'simple']` but the backend only accepts `'architect'`. This causes a 400 error when users try to apply a template.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Update OpenAPI spec enum]** — `backend/src/api/ticketPlanning.js`
   - Line ~102: change `enum: [architect]` → `enum: [architecture, technical, simple]`
   - *Depends on*: nothing

2. **[Update template mapping in controller]** — `backend/src/controllers/ticketPlanningController.js`
   - Find the template mapping object (currently has `'architect'` key)
   - Replace with three entries:
     - `'architecture'` → system design template content
     - `'technical'` → technical implementation template content
     - `'simple'` → basic task list template content
   - *Depends on*: Step 1

3. **[Search for stray `'architect'` references]** — `backend/src/`
   - Run `grep -rn "'architect'" backend/src/` to find any other references
   - Update or remove as needed
   - *Depends on*: Steps 1, 2

4. **[Verify frontend]** — `frontend/src/views/TicketDetail.vue:435`
   - Template options are already `['architecture', 'technical', 'simple']` — verify no changes needed
   - *Depends on*: Steps 1, 2, 3

5. **[Run verification]** — `cd backend && cd frontend`
   - `cd backend && npm test` — backend tests pass
   - `cd frontend && npm test -- --run` — frontend tests pass
   - `cd frontend && npm run lint` — no lint errors
   - `cd frontend && npm run typecheck` — no TS errors
   - `cd frontend && npm run generate:spec && npm run generate:api` — regenerate types
   - *Depends on*: Steps 1-4

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
- [ ] Test `applyTemplate` with `templateName: 'architecture'` → returns planning files
- [ ] Test `applyTemplate` with `templateName: 'technical'` → returns planning files
- [ ] Test `applyTemplate` with `templateName: 'simple'` → returns planning files
- [ ] Test `applyTemplate` with `templateName: 'architect'` → returns 400 (old name no longer valid)
- [ ] Test `applyTemplate` with unknown template name → returns 400
- [ ] Every new template mapping has at least one test case

#### Backend Jest Integration Tests
- [ ] Full request lifecycle: POST with valid template name → 200 with planning files
- [ ] Invalid template name → 400

#### Backend Bash Integration Suite
- [ ] Add test in `backend/integration-test/suites/` for apply-template endpoint:
  - POST with `templateName: 'architecture'` → 200
  - POST with `templateName: 'technical'` → 200
  - POST with `templateName: 'simple'` → 200
  - POST with `templateName: 'architect'` → 400
  - POST with unknown template name → 400

#### Frontend Unit Tests
- [ ] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/ticketPlanning.test.js`
- [ ] If `ticketPlanning.test.js` exists: verify it tests the apply-template API client

#### Frontend E2E Tests
- [ ] Manual: Apply each template in the UI, verify files are created

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify apply-template response shape
- [ ] Generated types regenerated: `cd frontend && npm run generate:spec && npm run generate:api`
- [ ] Generated types compile: `cd frontend && npm run typecheck`

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
