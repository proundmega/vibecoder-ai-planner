# bp-29: Per-Project AI Provider Config + ProviderService — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

## Purpose
Let each project configure its own AI provider (local or cloud) instead of one-size-fits-all agent env vars.

## Implementation Order

1. **Create migration** — `backend/src/migrations/020_provider_configs.sql`
   - *Depends on*: nothing

2. **Create ProviderService.js** — `backend/src/services/ProviderService.js`
   - getConfig, setConfig, deleteConfig, testConnection
   - *Depends on*: Step 1

3. **Modify provider API routes** — `backend/src/api/providers.js`
   - Add project-scoped CRUD endpoints
   - *Depends on*: Step 2

4. **Create frontend API client functions** — `frontend/src/api/providers.js` (verify exists, modify if so)
   - *Depends on*: nothing (uses existing get/post/put/del)

5. **Add Provider Config tab to ProjectDetail.vue** — `frontend/src/views/ProjectDetail.vue`
   - New tab with provider form + test connection button
   - *Depends on*: Step 4

6. **Modify Java agent** — Fetch project config instead of env vars
   - *Depends on*: Step 3

## Per-File Action Plan

### `backend/src/services/ProviderService.js` (CREATE)
- `async getConfig(projectId)` → SELECT FROM provider_configs WHERE project_id = $1 AND is_active = true
- `async setConfig(projectId, config)` → UPSERT (INSERT ON CONFLICT UPDATE)
- `async deleteConfig(projectId)` → SET is_active = false
- `async testConnection(config)` → Use axios to POST a trivial prompt to the configured endpoint, return { success, latency_ms, error? }

### `backend/src/api/providers.js` (MODIFY)
- GET /projects/:id/provider — get config
- PUT /projects/:id/provider — set config
- DELETE /projects/:id/provider — deactivate
- POST /projects/:id/provider/test — test connection

### `frontend/src/api/providers.js` (MODIFY)
- Add `fetchProviderConfig(projectId)`, `setProviderConfig(projectId, config)`, `deleteProviderConfig(projectId)`, `testProviderConnection(projectId, config)`

### `frontend/src/views/ProjectDetail.vue` (MODIFY)
- Add `'AI Provider'` tab to tabs array
- Form: provider dropdown, endpoint URL, model, credential selector, fallback, test button

### `agent/src/.../TicketProcessor.java` (MODIFY)
- At ticket pickup, call `apiService.getProviderConfig(projectId)` to get provider config
- Pass config to provider constructor instead of AgentConfig constants

## Test Plan
1. CRUD provider config via API
2. Test connection with local Ollama
3. Verify agent fetches config and uses correct provider
4. Verify existing tickets without config fall back to agent env vars

## Rollback Steps
1. Run 020_rollback.sql
2. Remove from apply.js
3. Revert frontend tab
