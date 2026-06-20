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

#### Phase 1: Frontend API Client

1. Fix `frontend/src/api/providers.js:8` — rename `provider` to `providerType`:
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

#### Phase 2: Frontend UI

2. Fix `frontend/src/views/ProjectDetail.vue` — find the provider form section (around line 438+):
   - Search for all references to `provider` in the provider tab's data/form state
   - Rename them to `providerType` (form state, submission object, template bindings)
   - Ensure the form label and placeholder text say "Provider Type" not "Provider"
   - Verify the edit flow also uses `providerType`

3. Verify the full flow works:
   - Add a new provider → check `provider_type` is stored in DB
   - List providers → check type is displayed
   - Edit a provider → check type is submitted correctly

#### Phase 3: Testing

4. Run frontend tests: `cd frontend && npm test -- --run`
5. Run frontend lint: `cd frontend && npm run lint`
6. Run frontend typecheck: `cd frontend && npm run typecheck`
7. Manual test: Add a provider in the UI, verify `provider_type` is not NULL in DB

---

### c) Dependencies

- None — this is a frontend-only fix

---

### d) Risks/Edge Cases

- **[Risk]**: Form state variable named `provider` used in multiple places — must rename consistently
  **[Mitigation]**: Use grep to find all `provider` references in the provider tab section

---

### e) Testing

#### Backend Unit Tests
- No backend changes — existing tests should pass

#### Frontend Unit Tests
- [ ] `npm test -- --run` — no regressions

#### Frontend E2E Tests
- [ ] Manual: Add provider with type "anthropic", verify it's stored

#### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

### f) Migration Notes

Not applicable — no database changes.

---

### g) Files Changed

**Frontend:**
```
frontend/src/api/providers.js         → rename provider → providerType in addProvider()
frontend/src/views/ProjectDetail.vue  → rename provider → providerType in provider form
```

---

### h) Code Review Checklist

- [ ] API client sends `providerType` (not `provider`)
- [ ] Form state uses `providerType` consistently
- [ ] Form label says "Provider Type"
- [ ] All tests pass
- [ ] No backend changes needed

---

### i) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] Add a provider in the UI → check DB: `SELECT provider_type FROM project_providers WHERE ...` → should NOT be NULL
5. [ ] Edit a provider → verify type persists
