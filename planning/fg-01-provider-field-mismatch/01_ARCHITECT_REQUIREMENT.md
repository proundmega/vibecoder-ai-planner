# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: 2026-06-19
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Small

---

## Requirement

Fix the field name mismatch in the AI Providers API. The frontend sends `provider` but the backend expects `providerType`. This means when a user adds or updates a provider, the `provider_type` column in `project_providers` is always `NULL`.

**Current behavior**: Provider type is never stored. All providers appear with an empty/null type.
**Expected behavior**: Provider type is correctly stored and displayed.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/providers.js` — YES
- [x] Controller exists: `backend/src/controllers/providerController.js` — YES
- [x] Service exists: `backend/src/services/ProviderRouter.js` — YES
- [x] Route is mounted: `backend/src/api/v1/index.js:33` — YES (`/providers`)
- [x] OpenAPI JSDoc annotations exist — YES

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/providers.js` — YES
- [ ] API client functions cover all needed endpoints — NO (field name mismatch)
- [x] API client follows existing patterns (`get`, `post`, `put`, `del`, `patch`) — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/ProjectDetail.vue` — YES (AI Providers tab)
- [x] Existing tab where this feature lives — YES (AI Providers tab at line ~438)
- [x] Existing modal/pattern to extend — YES (add/edit provider form)

### Integration Check
- [x] Frontend API client can call existing backend endpoints — YES (paths are correct)
- [ ] Response shapes match (snake_case vs camelCase) — NO (`provider` vs `providerType`)
- [x] Auth tokens are used correctly — YES
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **FRONTEND-ONLY fix**. The backend API is correct — it expects `providerType`. The frontend API client sends the wrong field name `provider`. No backend changes needed.

**Example**: "The AI Providers API (`/api/v1/providers/${projectId}/providers`) already exists in the backend with correct field names (`providerType`). The frontend API client `frontend/src/api/providers.js:8` sends `{ name, provider, apiKey }` but should send `{ name, providerType, apiKey }`. Fix the field name in the API client and in the Vue component that calls it."

---

## Scope

### In Scope
- [ ] Fix `frontend/src/api/providers.js` — change `provider` to `providerType` in `addProvider()` call
- [ ] Fix `frontend/src/views/ProjectDetail.vue` — change `provider` to `providerType` in the add/edit provider form data
- [ ] Verify the field propagates correctly through the full flow (add → list → edit → update)

### Out of Scope
- Backend controller changes (controller already expects `providerType`)
- Database schema changes
- New API endpoints
- New UI components

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

The fix is straightforward: rename `provider` to `providerType` in the frontend. The backend controller at `providerController.js:9` already destructures `providerType` from the request body.

---

## Acceptance Criteria

1. [ ] [Frontend API] `addProvider()` in `frontend/src/api/providers.js` sends `providerType` instead of `provider`
2. [ ] [Frontend UI] The add/edit provider form in `ProjectDetail.vue` uses `providerType` field name
3. [ ] [Frontend UI] When a provider is added, the `provider_type` column in the database is correctly populated
4. [ ] [Frontend UI] When a provider is listed, the provider type is displayed correctly
5. [ ] [Frontend UI] When a provider is edited, the `providerType` field is correctly submitted
6. [ ] [Both] All tests pass (`npm test` in both frontend and backend)
7. [ ] [Both] Linting passes (`npm run lint` in frontend)
8. [ ] [Both] Frontend typecheck passes (`npm run typecheck`)

---

## Out of Scope

- Adding new provider types or changing the enum of allowed types
- Backend changes to the `providerType` field handling
- Database migration for the `project_providers` table

---

## Testing Checklist

### Backend Tests
- No backend changes — no new tests needed
- Existing tests should still pass

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — verify no regressions
- [ ] Manual verification: add a provider in the UI, check database has `provider_type` populated

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Changing the backend** — the backend is correct, only the frontend has the bug
- ❌ **Creating a new API client** — fix the existing one
- ❌ **Adding a transformation layer** — just rename the field
- ❌ **Ignoring the edit form** — the same field name is used in both add and edit flows
