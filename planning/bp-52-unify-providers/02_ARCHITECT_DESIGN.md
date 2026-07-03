# BP-52: Unify Provider Config & AI Providers — Design

## Current State Analysis

### `provider_configs` table
- Single row per project (UNIQUE project_id, provider)
- Fields: `id`, `project_id`, `provider`, `endpoint_url`, `model`, `api_key_credential_id`, `fallback_provider`, `routing_rules`, `is_active`
- Used by: `getProviderConfig`, `setProviderConfig`, `testProviderConnection`, `ProviderService.resolveProvider`
- Frontend: "Provider Config" tab in ProjectDetail.vue

### `project_providers` table
- Multiple rows per project
- Fields: `id`, `project_id`, `name`, `provider_type`, `api_key_encrypted`, `base_url`, `model`, `roles`, `max_tokens`, `temperature`, `is_active`
- Used by: `ProviderRouter.loadProviders()`, `ProviderService.getProjectProvider()`, `listProviders`, `addProvider`, `updateProvider`, `deleteProvider`, `testProvider`
- Frontend: "AI Providers" tab in ProjectDetail.vue

### Key Differences

| Field | provider_configs | project_providers |
|---|---|---|
| name | No | Yes |
| provider_type/provider | Yes | Yes |
| model | Yes | Yes |
| api_key | Yes (encrypted) | Yes (encrypted) |
| base_url/endpoint_url | endpoint_url | base_url |
| max_tokens | No | Yes |
| temperature | No | Yes |
| fallback_provider | Yes | No |
| routing_rules | Yes | No |
| roles | No | Yes |
| is_project_director | No | No |

## Design Decision: Extend `project_providers`

### Why extend `project_providers` over creating a new table?
1. `project_providers` already supports multiple providers per project
2. `project_providers` already has encryption, CRUD, and ProviderRouter integration
3. `provider_configs` is a simpler subset — extending `project_providers` avoids duplicating CRUD logic
4. One migration: add columns to existing table, no data duplication

### Schema Changes

Add to `project_providers`:
```sql
ALTER TABLE project_providers ADD COLUMN endpoint_url VARCHAR(512);
ALTER TABLE project_providers ADD COLUMN fallback_provider VARCHAR(32);
ALTER TABLE project_providers ADD COLUMN routing_rules JSONB DEFAULT '{}';
ALTER TABLE project_providers ADD COLUMN is_project_director BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_project_providers_director ON project_providers(project_id) WHERE is_project_director = true;
```

Unique constraint to ensure only one director per project:
```sql
-- PostgreSQL partial unique index (only one TRUE per project_id)
CREATE UNIQUE INDEX uq_project_providers_single_director 
  ON project_providers(project_id) 
  WHERE is_project_director = true;
```

### API Changes

**Routes** (`backend/src/api/providers.js`):
- Keep existing routes: `GET/POST/PATCH/DELETE /:projectId/providers`
- Keep existing routes: `POST /:projectId/providers/:providerId/test`
- **New**: `PATCH /:projectId/providers/:providerId/directorate` — set/demote project director
- **Deprecate**: `GET/PUT/DELETE/POST /projects/:projectId/provider` (Provider Config routes) — return 410 Gone with migration note

**Controller** (`backend/src/controllers/providerController.js`):
- `addProvider`: accept new fields `endpoint_url`, `fallback_provider`, `routing_rules`
- `updateProvider`: accept new fields `endpoint_url`, `fallback_provider`, `routing_rules`
- `listProviders`: return all fields including `endpoint_url`, `fallback_provider`, `routing_rules`, `is_project_director`
- `testProvider`: unchanged (uses existing fields)
- **New**: `setDirector(providerId)` — sets `is_project_director=true` for given provider, sets `false` for any existing director in same project

**Service** (`backend/src/services/ProviderService.js`):
- `getProjectProvider()`: change from `ORDER BY created_at DESC LIMIT 1` to `WHERE is_project_director = true LIMIT 1`
- `resolveProvider()`: unchanged logic, just uses the new fields from `project_providers`

**Service** (`backend/src/services/ProviderRouter.js`):
- `loadProviders()`: already loads from `project_providers`, no change needed
- `getForRole()`: unchanged

### Data Flow

```
User creates provider → POST /providers/:projectId/providers
  → insert into project_providers with all fields
  → if is_project_director=true in body, demote existing director

User sets director → PATCH /providers/:projectId/providers/:providerId/directorate
  → UPDATE project_providers SET is_project_director=true WHERE id=$1
  → UPDATE project_providers SET is_project_director=false WHERE project_id=$2 AND id!=$1

Agent needs provider → ProviderService.getProjectProvider(projectId)
  → SELECT * FROM project_providers WHERE project_id=$1 AND is_project_director=true LIMIT 1

ProviderRouter loads → ProviderRouter.loadProviders(projectId)
  → SELECT * FROM project_providers WHERE project_id=$1 AND is_active=true
```

### Frontend Changes

**ProjectDetail.vue**:
- Remove "Provider Config" tab from tabs array
- Merge Provider Config form fields into the "AI Providers" add/edit forms
- Add "Set as Project Director" button/action on each provider card
- Show a badge/label on the provider card indicating it's the Project Director
- When adding a new provider, include a checkbox "Set as Project Director" (default: checked if no director exists)
- Keep `providerConfig` ref and related functions but repurpose them to interact with the unified provider API

**API** (`frontend/src/api/providers.js`):
- Remove: `fetchProviderConfig`, `setProviderConfig`, `deleteProviderConfig`, `testProviderConnection`
- Add: `setProjectDirector(projectId, providerId)` → `PATCH /api/v1/providers/:projectId/providers/:providerId/directorate`
- Existing functions (`listProviders`, `addProvider`, `updateProvider`, `deleteProvider`, `testProvider`) remain unchanged

### Migration Strategy

**Migration file: `031_unify_providers.sql`**:
1. Add new columns to `project_providers`
2. Add partial unique index for director constraint
3. Mark `provider_configs` as deprecated (add comment, don't drop)
4. Data migration: if `provider_configs` has a row and `project_providers` is empty, create a default provider from `provider_configs` data and set it as director

**Rollback: `031_unify_providers_rollback.sql`**:
1. Drop the new columns
2. Drop the unique index
3. Drop the director index

### Impact Matrix

| File | Change |
|---|---|
| `backend/src/migrations/031_unify_providers.sql` | NEW — add columns, indexes, data migration |
| `backend/src/migrations/031_unify_providers_rollback.sql` | NEW — rollback |
| `backend/src/migrations/apply.js` | Add `031_unify_providers.sql` to SQL_FILES |
| `backend/src/controllers/providerController.js` | Add fields to add/update, add setDirector |
| `backend/src/services/ProviderService.js` | Change getProjectProvider to query director |
| `backend/src/api/providers.js` | Deprecate provider config routes, add director route |
| `backend/src/validators/providers.js` | Add endpoint_url, fallback_provider, routing_rules to schemas |
| `frontend/src/views/ProjectDetail.vue` | Merge tabs, merge forms, add director badge/action |
| `frontend/src/api/providers.js` | Remove provider config functions, add setProjectDirector |
| `frontend/src/router/index.ts` | Remove Provider Config route if it exists |
| `backend/src/__tests__/providerController.test.js` | Add tests for director constraint |
| `backend/src/__tests__/providerService.test.js` | Update getProjectProvider tests |
