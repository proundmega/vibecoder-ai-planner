# BP-52: Unify Provider Config & AI Providers — Implementation

## Step-by-Step Implementation Plan

### Phase 1: Database Migration (Backend)

**File**: `backend/src/migrations/031_unify_providers.sql`

1. Add columns to `project_providers`:
   - `endpoint_url VARCHAR(512)`
   - `fallback_provider VARCHAR(32)`
   - `routing_rules JSONB DEFAULT '{}'`
   - `is_project_director BOOLEAN DEFAULT FALSE`

2. Create partial unique index:
   ```sql
   CREATE UNIQUE INDEX uq_project_providers_single_director 
     ON project_providers(project_id) 
     WHERE is_project_director = true;
   ```

3. Create director index for fast lookups:
   ```sql
   CREATE INDEX idx_project_providers_director 
     ON project_providers(project_id) 
     WHERE is_project_director = true;
   ```

4. Optional data migration: if `provider_configs` has data and `project_providers` is empty, insert a default provider row.

**File**: `backend/src/migrations/031_unify_providers_rollback.sql`

1. Drop indexes
2. Drop columns

**File**: `backend/src/migrations/apply.js`

1. Add `'031_unify_providers.sql'` to SQL_FILES array

### Phase 2: Backend API Changes

**File**: `backend/src/validators/providers.js`

1. Add to `addProviderSchema`:
   - `endpoint_url` (optional string)
   - `fallback_provider` (optional string, allows null)
   - `routing_rules` (optional object)
   - `is_project_director` (optional boolean, default false)

2. Add to `updateProviderSchema`:
   - Same fields as above

**File**: `backend/src/controllers/providerController.js`

1. `addProvider`:
   - Accept new fields from `req.body`
   - Insert into SQL with new columns

2. `updateProvider`:
   - Accept new fields in updates array
   - Handle `is_project_director` updates (if setting to true, demote existing)

3. `listProviders`:
   - Return `endpoint_url`, `fallback_provider`, `routing_rules`, `is_project_director`

4. **New** `setDirector(providerId)`:
   - Verify provider exists and belongs to project
   - Set `is_project_director = true` for the given provider
   - Set `is_project_director = false` for any existing director in same project
   - Return updated provider

**File**: `backend/src/services/ProviderService.js`

1. `getProjectProvider()`:
   - Change query from `ORDER BY created_at DESC LIMIT 1` to `WHERE is_project_director = true LIMIT 1`

2. `resolveProvider()`:
   - No logic change, just uses the new fields from `project_providers`

**File**: `backend/src/api/providers.js`

1. **Deprecate** Provider Config routes (lines 12-15):
   - Return 410 Gone with message: "Provider Config has been merged into AI Providers"
   - Or remove entirely (breaking change — prefer 410 for backward compat)

2. **Add** director route:
   ```javascript
   router.patch('/:projectId/providers/:providerId/directorate', 
     verifyToken, 
     requireAnyPermission('PROJECT_MANAGE_MEMBERS'), 
     providerController.setDirector
   );
   ```

### Phase 3: Frontend Changes

**File**: `frontend/src/api/providers.js`

1. Remove:
   - `fetchProviderConfig`
   - `setProviderConfig`
   - `deleteProviderConfig`
   - `testProviderConnection`

2. Add:
   ```javascript
   export function setProjectDirector(projectId, providerId) {
     return patch(`/api/v1/providers/${projectId}/providers/${providerId}/directorate`)
   }
   ```

3. Update `addProvider` to accept full config object:
   ```javascript
   export function addProvider(projectId, config) {
     return post(`/api/v1/providers/${projectId}/providers`, config)
   }
   ```

4. Update `updateProvider` similarly

**File**: `frontend/src/views/ProjectDetail.vue`

1. **Tabs**: Remove "Provider Config" tab, keep only "AI Providers"

2. **State**: Merge `providerConfig` ref fields into `newProviderName`/`newProviderType`/`newProviderKey` state:
   - Remove `providerConfig`, `providerConfigLoading`, `providerConfigSaving`, `providerConfigTestResult`, `providerConfigLoaded`
   - Extend add form state: `newProviderEndpoint`, `newProviderFallback`, `newProviderIsDirector`
   - Extend edit form state: `editProviderEndpoint`, `editProviderFallback`, `editProviderIsDirector`

3. **Add Provider Form**: Expand to include all fields:
   - Name, Type (provider_type), Model, API Key, Base URL, Endpoint URL
   - Max Tokens, Temperature
   - Fallback Provider
   - Checkbox: "Set as Project Director"

4. **Edit Provider Form**: Expand similarly

5. **Provider Cards**: Add:
   - "Set as Director" button (disabled if already director)
   - "Set as Director" badge (if already director)
   - Show endpoint_url, fallback_provider if set

6. **Load/Save**: 
   - `loadProviders()` remains the same (single API call)
   - `handleAddProvider()` sends full config object
   - `handleUpdateProvider()` sends full config object
   - New `handleSetDirector(providerId)` calls `setProjectDirector`

7. **CSS**: Add styles for director badge and expanded form fields

### Phase 4: Tests

**File**: `backend/src/__tests__/providerController.test.js`

1. Test `setDirector` endpoint:
   - Sets director correctly
   - Demotes existing director
   - Enforces single director constraint (409 Conflict if concurrent)

2. Test `addProvider` with new fields:
   - Accepts `endpoint_url`, `fallback_provider`, `routing_rules`

3. Test `updateProvider` with `is_project_director`:
   - Updates director flag correctly

**File**: `backend/src/__tests__/providerService.test.js`

1. Test `getProjectProvider()` returns director, not just latest

### Phase 5: Cleanup

1. Run full test suite: `npm test`
2. Run typecheck: `npm run typecheck` (frontend)
3. Verify migration applies cleanly on fresh DB
4. Remove references to `provider_configs` in comments/docs
5. Update OpenAPI spec: `npm run generate:spec`
