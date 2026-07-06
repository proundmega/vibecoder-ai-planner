# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

When users add or edit an AI Provider in the ProjectDetail "AI Providers" tab, the provider type (e.g., "anthropic", "openai", "gemini") is never stored in the database. This is because the frontend API client sends `provider` but the backend controller expects `providerType`. As a result, all providers are created with a NULL `provider_type`, which breaks provider routing and display.

---

## Current State

### Existing Backend
- **Route**: `POST /api/v1/providers/:id/providers` — `providerController.addProvider()`
- **Controller**: `backend/src/controllers/providerController.js:9` — destructures `{ name, providerType, apiKey, baseUrl, model, roles, maxTokens, temperature }`
- **Database**: `project_providers` table has `provider_type` column (NOT NULL with default)
- **Response**: Returns `providerType: row.provider_type` (camelCase conversion at line 31)

### Existing Frontend
- **API Client**: `frontend/src/api/providers.js:8` — sends `{ name, provider, apiKey }` (wrong field name)
- **UI**: `frontend/src/views/ProjectDetail.vue` — provider form uses `provider` field name

### Gap Analysis
- Backend API is correct — expects `providerType`
- Frontend API client sends wrong field name `provider`
- Frontend UI form uses wrong field name `provider`
- Result: `provider_type` column is always NULL

---

## Design

### Option A: Fix Field Names in Frontend (Recommended)

**Change 1 — API client** (`frontend/src/api/providers.js:8`):
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

**Change 2 — UI form** (`frontend/src/views/ProjectDetail.vue`):
- Find all references to `provider` in the provider form data
- Rename to `providerType` to match the API client parameter and backend expectation
- This affects the form submission object and the form state variable

**Why this is the right choice**: It's a 2-line rename that fixes the root cause. No backend changes, no new code, no data migration needed.

### Option B: Change Backend to Accept Both Field Names

Accept both `provider` and `providerType` for backward compatibility.

**Pros**: Would also fix any other callers that use the wrong field name.
**Cons**: Adds unnecessary complexity to the backend. There are no other callers — only the frontend uses this API.
**Decision**: Option A is better. The backend should enforce its own contract.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/api/providers.js` | MODIFY | Line ~8: rename `provider` → `providerType` in `addProvider()` parameter and body |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Provider form section (~line 438+): rename all `provider` references to `providerType` in form state, submission object, template bindings |

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/providers.test.js` | API client sends correct field name |
| Frontend contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Response shape includes `providerType` |
| Frontend component | Cypress | `frontend/cypress/component/` | Provider form renders and submits correctly |
| Frontend E2E | Cypress | `frontend/cypress/e2e/` | Full add-provider flow |

### Frontend-Backend Contract Testing

- Response schemas in `frontend/src/api/validator.ts` must include `providerType` (not `provider`)
- If the contract test has a provider shape assertion, update `provider` → `providerType`
- Generated TypeScript types from OpenAPI spec should include `providerType` — verify by running `npm run generate:spec && npm run generate:api && npm run typecheck`

---

## Security Considerations

- No new endpoints — existing auth/authorization applies unchanged
- No new data exposure — field rename does not change what data is returned
- Input validation unchanged — backend Joi schema already expects `providerType`

---

## Data Flow Diagram

```
[User fills form] → [Vue component sends { name, providerType, apiKey }]
  → [API client POST /api/v1/providers/:id/providers]
  → [Backend controller receives providerType]
  → [INSERT INTO project_providers (..., provider_type, ...)]
  → [Database stores correct value]
```

---

## Dependencies

### Backend Dependencies
- None — no backend changes needed

### Frontend Dependencies
- `frontend/src/api/providers.js` — fix field name in `addProvider()`
- `frontend/src/views/ProjectDetail.vue` — fix field name in provider form

### Cross-Cutting Dependencies
- None

---

## Config / Environment Changes

- No env var changes
- No database migrations
- No npm dependency changes

---

## Risks and Edge Cases

### Backend Risks
- None

### Frontend Risks
- **[Risk]**: The form state variable might be named `provider` and used in multiple places — need to rename consistently
  **[Mitigation]**: Search for all `provider` references in the provider tab section of ProjectDetail.vue and rename them all

### Integration Risks
- None

### Edge Cases
- Existing providers in the database with NULL `provider_type` — they will continue to show as "Unknown" or empty. Not in scope to fix.
- The `testProvider` endpoint uses `providerConfig.provider_type` internally — it reads from the database, so it's unaffected by this change.

---

## Alternative Designs Considered

### Alternative 1: Backend accepts both `provider` and `providerType`
- **Pros**: Backward compatible
- **Cons**: Unnecessary complexity, no other callers exist
- **Decision**: Option A is cleaner

### Alternative 2: Add a transformation layer in the API client
- **Pros**: Centralized transformation
- **Cons**: Over-engineering a single field rename
- **Decision**: Option A is simpler

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file (if a small model will execute this ticket)

---

*This design document guides implementation. The fix is a straightforward field rename in two frontend files.*
