# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-01 — Fix provider field name mismatch (provider → providerType)

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Fix the field name mismatch that prevents provider types from being stored. The frontend sends `provider` but the backend expects `providerType`. Without this fix, the AI Providers tab shows all providers with a null/empty type.

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Fix API client]** — `frontend/src/api/providers.js`
   - Rename `provider` → `providerType` in `addProvider()` function (parameter name and request body)
   - *Depends on*: nothing

2. **[Fix UI form]** — `frontend/src/views/ProjectDetail.vue`
   - Search for all references to `provider` in the provider tab's data/form state (~line 438+)
   - Rename to `providerType` (form state, submission object, template bindings)
   - Ensure the form label and placeholder text say "Provider Type" not "Provider"
   - Verify the edit flow also uses `providerType`
   - *Depends on*: Step 1

3. **[Run verification]** — `cd frontend`
   - `npm test -- --run` — no regressions
   - `npm run lint` — no lint errors
   - `npm run typecheck` — no TS errors
   - *Depends on*: Steps 1, 2

---

### c) Per-File Action Plan

#### `frontend/src/api/providers.js` (MODIFY)
- **Change**: Rename `provider` → `providerType` in `addProvider()` function
- **Line ~8**:
  ```javascript
  // Before:
  export function addProvider(projectId, name, provider, apiKey) {
    return post(`/api/v1/providers/${projectId}/providers`, { name, provider, apiKey })
  }
  // After:
  export function addProvider(projectId, name, providerType, apiKey) {
    return post(`/api/v1/providers/${projectId}/providers`, { name, providerType, apiKey })
  }
  ```
- **Imports needed**: None (existing imports unchanged)

#### `frontend/src/views/ProjectDetail.vue` (MODIFY)
- **Change**: Rename all `provider` references in the provider tab section to `providerType`
- **Position**: Provider form section (~line 438+)
- **What to rename**:
  - Form state variable: `provider` → `providerType`
  - Form submission object: `{ name, provider, apiKey }` → `{ name, providerType, apiKey }`
  - Template bindings: `v-model="provider"` → `v-model="providerType"`
  - Edit flow: ensure edit form also uses `providerType`
  - Form label: "Provider" → "Provider Type"
- **Imports needed**: None (existing imports unchanged)

---

### d) Dependencies

- None — this is a frontend-only fix, no backend changes, no new dependencies

---

### e) Risks/Edge Cases

- **[Risk]**: Form state variable named `provider` used in multiple places — must rename consistently
  **[Mitigation]**: Use grep to find all `provider` references in the provider tab section of ProjectDetail.vue before changing

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- No backend changes — existing tests should pass

#### Backend Jest Integration Tests
- N/A — no backend changes

#### Backend Bash Integration Suite
- N/A — no backend API changes

#### Frontend Unit Tests
- [ ] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/providers.test.js`
- [ ] If `providers.test.js` exists: add test case verifying `addProvider()` sends `providerType` field

#### Frontend E2E Tests
- [ ] Manual: Add provider with type "anthropic", verify it's stored in DB

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify provider response shape includes `providerType` (not `provider`)
- [ ] `frontend/src/api/validator.ts` — verify provider schema expects `providerType` field

---

### g) Migration Notes

Not applicable — no database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/api/providers.js         → MODIFY: rename provider → providerType in addProvider()
frontend/src/views/ProjectDetail.vue  → MODIFY: rename provider → providerType in provider form
```

---

### i) Code Review Checklist

- [ ] API client sends `providerType` (not `provider`) in request body
- [ ] Form state uses `providerType` consistently (add form, edit form, submission object)
- [ ] Form label says "Provider Type" not "Provider"
- [ ] All `provider` references in provider tab section renamed
- [ ] No backend changes needed
- [ ] Frontend API client follows existing patterns (`get`, `post`, `put`, `del`, `patch` from `./client`)
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states (unchanged from before)
- [ ] All tests written and passing — existing tests still pass
- [ ] OpenAPI spec regenerated if backend routes changed (N/A — no backend changes)
- [ ] Generated TypeScript types regenerated if response shapes changed (N/A — no backend changes)
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes (N/A — no backend changes)
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers provider shape with `providerType`
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] `cd frontend && npm run build` passes
5. [ ] Add a provider in the UI → check DB: `SELECT provider_type FROM project_providers WHERE ...` → should NOT be NULL
6. [ ] Edit a provider → verify type persists
7. [ ] List providers → verify type is displayed
8. [ ] Verify no 404 errors in browser console for provider API calls

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
