# 00_ARCHITECT_CHECKLIST.md — fg-29 Provider Config API Key Field

**Status**: in-progress
**Date created**: 2026-06-30
**Effort**: Medium

## Planning

- [ ] API key input field added to Provider Config tab in ProjectDetail.vue
- [ ] Backend validator accepts `api_key` (raw string) as optional field
- [ ] Backend controller stores/updates API key in `provider_configs` table
- [ ] Field name alignment: frontend snake_case → backend snake_case
- [ ] API key visible for all provider types (openai, claude, ollama, vllm, llamacpp, custom), marked as optional
- [ ] API key masking: first 4 + last 4 characters visible, middle obscured (e.g., `sk-1234••••5678`)
- [ ] Frontend typecheck passes (vue-tsc --noEmit)
- [ ] All existing tests pass

## Existing Infrastructure Audit

### What Already Exists
- `frontend/src/views/ProjectDetail.vue` — Provider Config tab at lines 485-531
- `frontend/src/api/providers.js` — `setProviderConfig(projectId, config)` sends full config object
- `backend/src/api/providers.js` — PUT `/providers/projects/:projectId/provider` route exists
- `backend/src/controllers/providerController.js` — `setProviderConfig` handler exists (lines 277-321)
- `backend/src/validators/providerConfig.js` — `setProviderConfigSchema` exists (lines 3-15)
- `backend/src/migrations/020_provider_configs.sql` — `api_key_credential_id UUID` column exists
- Backend `testProviderConnection` handler already accepts `apiKey` in request body (lines 349-370)
- Provider config types defined in `ProjectDetail.vue` (lines 98-105): openai, claude, ollama, vllm, llamacpp, custom
- `maskToken` utility already exists in `crypto.js` — reuse for consistent masking

### What Does NOT Exist
- No API key input field in the Provider Config form UI
- No `api_key` field in the `setProviderConfigSchema` validator
- No `api_key_encrypted` column in `provider_configs` table
- Controller expects camelCase (`endpointUrl`, `fallbackProvider`) but frontend sends snake_case (`endpoint_url`, `fallback_provider`)
- Controller expects `apiKey` (raw string) but validator expects `api_key_credential_id` (UUID)

## Dependency Analysis

- **ProjectDetail.vue** — needs API key input field + conditional rendering logic
- **providerConfig.js (validator)** — needs `api_key` added as optional string
- **providerController.js** — needs field name alignment (snake_case → controller) and API key storage logic
- **providers.js (frontend API)** — may need field name adjustment if we standardize on snake_case
- No new database migration needed — `api_key_credential_id` column already exists in `provider_configs`

## Configuration Audit

- Uses existing `@/` alias in frontend
- Uses existing Vue 3 `<script setup>` pattern
- Uses existing scoped CSS convention
- No new dependencies required
- No environment variables needed

## Testing Strategy

- Frontend typecheck: `npm run typecheck` — vue-tsc --noEmit
- Unit tests: `npm test -- --run` — vitest (frontend)
- Manual testing: Navigate to `/projects/:id` → Provider Config tab
- Verify API key field appears for cloud providers, hidden for local models
- Verify save sends `api_key` field to backend
- Verify test connection works with API key provided

## Rollback Readiness

- Remove API key input field from ProjectDetail.vue
- Revert validator changes in providerConfig.js
- Revert controller changes in providerController.js
- Revert field name changes in providers.js (frontend)
- No database changes — rollback is purely code revert

## When to Ask the User

- N/A — API key is a standard field, visibility conditional on provider type is obvious
