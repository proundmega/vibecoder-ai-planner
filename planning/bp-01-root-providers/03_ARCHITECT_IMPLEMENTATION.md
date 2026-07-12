# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend | Frontend | Database

**Dependencies**: None

---

### a) Purpose

Move AI providers from per-project to global scope, and connect agents to providers. This makes providers reusable infrastructure that any agent can use, rather than duplicating provider config per project.

---

### b) Actions

**Implementation Order** (strict — each step depends on the previous):

1. **Database migration** — `backend/src/migrations/032_global_providers.sql`
   - Create `providers` table
   - Add `provider_id` to `agents`
   - Migrate data from `project_providers`
   - Create indexes
   - *Depends on*: nothing

2. **Update migration apply order** — `backend/src/migrations/apply.js`
   - Add 032 to SQL_FILES array in correct position (after 031)
   - *Depends on*: Step 1

3. **Backend: Provider routes** — `backend/src/api/providers.js`
   - Remove `:projectId` prefix from all routes
   - Add deprecation stubs for old routes (410 GONE)
   - Add `GET /:id/agents` route
   - *Depends on*: Step 1

4. **Backend: Provider controller** — `backend/src/controllers/providerController.js`
   - Remove `projectId` from all methods
   - Query `providers` table instead of `project_providers`
   - Add deprecation response helper
   - *Depends on*: Step 3

5. **Backend: Provider service** — `backend/src/services/ProviderService.js`
   - `resolveProvider()` no longer takes `projectId`
   - Query global providers
   - *Depends on*: Step 4

6. **Backend: Agent service** — `backend/src/services/AgentService.js`
   - Accept `providerId` in `create()`
   - Validate `providerId` exists in `providers` table
   - Include provider info in `list()` and `getAgentByApiKey()`
   - *Depends on*: Step 1

7. **Backend: Agent routes** — `backend/src/api/agents.js`
   - Accept `providerId` in create request body
   - *Depends on*: Step 6

8. **Backend: Route mount** — `backend/src/api/v1/index.js`
   - Update provider route mount (no projectId param)
   - *Depends on*: Step 3

9. **Frontend: Provider API client** — `frontend/src/api/providers.ts`
   - Remove `projectId` from all function signatures
   - *Depends on*: Step 3

10. **Frontend: Agent API client** — `frontend/src/api/agents.ts`
    - Add `providerId` to `createAgent()`
    - *Depends on*: Step 7

11. **Frontend: Providers page** — `frontend/src/views/Providers.vue`
    - Create new root-level providers management page
    - *Depends on*: Step 9

12. **Frontend: Router** — `frontend/src/router/index.ts`
    - Add `/providers` route
    - *Depends on*: Step 11

13. **Frontend: Nav link** — `frontend/src/App.vue`
    - Add "Providers" link to nav bar
    - *Depends on*: Step 12

14. **Frontend: AgentModal** — `frontend/src/components/AgentModal.vue`
    - Add provider selector dropdown
    - Load providers on mount
    - *Depends on*: Step 9, 11

15. **Frontend: Remove Providers tab** — `frontend/src/views/ProjectDetail.vue`
    - Remove Providers tab from tabs array
    - Remove provider panel, state, functions, CSS
    - *Depends on*: Step 11

---

### c) Per-File Action Plan

#### `backend/src/migrations/032_global_providers.sql` (CREATE)

```sql
-- Create global providers table
CREATE TABLE IF NOT EXISTS providers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'claude',
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  model VARCHAR(100) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'],
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  endpoint_url VARCHAR(512),
  fallback_provider VARCHAR(32),
  routing_rules JSONB DEFAULT '{}',
  is_project_director BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE providers ADD CONSTRAINT unique_provider_name_type UNIQUE (name, provider_type);

-- Add provider_id to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_agents_provider_id ON agents(provider_id);

-- Migrate data from project_providers
INSERT INTO providers (name, provider_type, api_key_encrypted, base_url, model, roles,
                       max_tokens, temperature, endpoint_url, fallback_provider, routing_rules,
                       is_project_director, is_active, created_at, updated_at)
SELECT DISTINCT ON (name, provider_type)
  name, provider_type, api_key_encrypted, base_url, model, roles,
  max_tokens, temperature, COALESCE(endpoint_url, NULL), fallback_provider,
  routing_rules, is_project_director, is_active, created_at, updated_at
FROM project_providers
WHERE is_active = true
ORDER BY name, provider_type, created_at ASC
ON CONFLICT (name, provider_type) DO NOTHING;
```

#### `backend/src/migrations/032_global_providers_rollback.sql` (CREATE)

```sql
-- Drop providers table
DROP TABLE IF EXISTS providers CASCADE;

-- Remove provider_id from agents
ALTER TABLE agents DROP COLUMN IF EXISTS provider_id;

-- Drop indexes (will be dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_providers_type;
DROP INDEX IF EXISTS idx_agents_provider_id;
```

#### `backend/src/migrations/apply.js` (MODIFY)

Add to `SQL_FILES` array after the 031 entries:
```js
'032_global_providers.sql',
```

#### `backend/src/api/providers.js` (MODIFY)

Change route prefix from `/:projectId/providers` to `/providers`:

```js
const router = require('express').Router();

// Root-level provider routes
router.get('/', listProviders);           // was /:projectId/providers
router.post('/', addProvider);            // was /:projectId/providers
router.get('/:id', getProvider);          // NEW — single provider
router.patch('/:id', updateProvider);     // was /:projectId/providers/:providerId
router.delete('/:id', deleteProvider);    // was /:projectId/providers/:providerId
router.post('/:id/test', testProvider);   // was /:projectId/providers/:providerId/test
router.patch('/:id/directorate', setDirector); // was /:projectId/providers/:providerId/directorate
router.get('/:id/agents', getProviderAgents); // NEW — list agents using this provider

// Deprecation stubs for old per-project routes
const deprecatedRoute = (req, res) => {
  res.status(410).json({
    success: false,
    error: { code: 'DEPRECATED', message: 'Providers are now global. Use /api/v1/providers instead.' }
  });
};

router.use('/:projectId/providers', deprecatedRoute);
router.use('/:projectId/providers/', deprecatedRoute);

module.exports = router;
```

#### `backend/src/controllers/providerController.js` (MODIFY)

- Remove `const projectId = req.params.projectId;` from all methods
- Change all queries from `project_providers` to `providers`
- Remove `projectId` from WHERE clauses
- Add `getProvider` method (single provider by ID)
- Add `getProviderAgents` method (list agents using a provider)

#### `backend/src/services/ProviderService.js` (MODIFY)

```js
// Before:
resolveProvider(projectId, ticketInfo) { ... }

// After:
resolveProvider(ticketInfo) { ... }
// Query providers table (no project_id filter)
// Use routing rules to select best provider
// First provider with matching role wins
```

#### `backend/src/services/AgentService.js` (MODIFY)

In `create(name, apiKey, userId)`:
```js
async create(name, apiKey, userId, providerId = null) {
  // Validate providerId if provided
  if (providerId) {
    const provider = await db.query('SELECT id FROM providers WHERE id = $1', [providerId]);
    if (provider.rows.length === 0) {
      throw new AppError('Provider not found', 404);
    }
  }
  // ... existing create logic, add provider_id to INSERT
}
```

In `list(userId)`:
```js
// JOIN with providers to include provider info
// SELECT agents.*, providers.name as provider_name, providers.provider_type
// FROM agents LEFT JOIN providers ON agents.provider_id = providers.id
// WHERE agents.owner_id = $1
```

#### `backend/src/api/agents.js` (MODIFY)

In create route:
```js
const { name, providerId } = req.body;
// ... validate name
const result = await AgentService.create(name, apiKey, userId, providerId);
```

#### `backend/src/api/v1/index.js` (MODIFY)

Change provider route mount:
```js
// Before:
router.use('/:projectId/providers', require('./providers'));

// After:
router.use('/providers', require('./providers'));
```

#### `frontend/src/api/providers.ts` (MODIFY)

Remove `projectId` from all functions:
```typescript
// Before:
export async function listProviders(projectId: string) { ... }
export async function addProvider(projectId: string, data: ...) { ... }

// After:
export async function listProviders() { ... }
export async function addProvider(data: ...) { ... }
```

#### `frontend/src/api/agents.ts` (MODIFY)

Add `providerId` to `createAgent`:
```typescript
export async function createAgent(name: string, providerId?: number) {
  return post('/api/v1/agents/create', { name, providerId });
}
```

#### `frontend/src/views/Providers.vue` (CREATE)

New root-level providers management page. Structure:
- `<script setup>` with provider state refs
- `listProviders()` on mount
- `handleAdd()`, `handleEdit()`, `handleDelete()`, `handleTest()` functions
- Template: header + "Add Provider" button + provider cards grid + add/edit modal
- Follow existing patterns from ProjectDetail.vue Providers tab

#### `frontend/src/router/index.ts` (MODIFY)

Add route:
```typescript
{
  path: '/providers',
  name: 'Providers',
  component: () => import('../views/Providers.vue'),
  meta: { requiresAuth: true },
}
```

#### `frontend/src/App.vue` (MODIFY)

Add Providers nav link:
```vue
<router-link v-if="showProvidersLink" to="/providers" class="nav-link">Providers</router-link>
```
```typescript
const showProvidersLink = computed(() => authStore.isProjectAdmin() || authStore.isSuperAdmin())
```

#### `frontend/src/components/AgentModal.vue` (MODIFY)

Add provider selector:
```vue
<select v-model="newAgent.providerId">
  <option :value="null">Select a provider...</option>
  <option v-for="p in providers" :key="p.id" :value="p.id">
    {{ p.name }} ({{ p.provider_type }})
  </option>
</select>
```
Load providers on mount via `listProviders()`.

#### `frontend/src/views/ProjectDetail.vue` (MODIFY)

Remove:
- `'providers'` from tabs array
- Provider state refs (`providers`, `providersLoading`, `providersError`, `showAddProvider`, `providerTypes`, `directorProviderId`)
- Provider panel `<div v-if="activeTab === 'providers'">...</div>`
- Provider functions (`loadProviders`, `handleAddProvider`, `handleEditProvider`, etc.)
- Provider CSS

---

### d) Dependencies

- [Backend service]: `ProviderService.resolveProvider()` — resolves global providers
- [Backend service]: `AgentService.create()` — accepts and validates `providerId`
- [Frontend API client]: `providers.ts` — updated function signatures
- [Frontend UI]: Providers page — new root-level management
- [Frontend UI]: AgentModal — provider selector
- [Database]: Migration 032 — new table + data migration

---

### e) Risks/Edge Cases

- **[Migration collision]**: If migration runs on a DB that already has `providers` table (partial run). **Mitigation**: `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING`.
- **[Agent without provider]**: `provider_id` is nullable. Agents work without one. **Mitigation**: Graceful handling in UI ("No provider selected").
- **[Provider deleted]**: `ON DELETE SET NULL` on FK. Agent's provider becomes null. **Mitigation**: Show warning in agent detail.
- **[Duplicate providers]**: `UNIQUE(name, provider_type)` prevents duplicates. Migration uses `DISTINCT ON`.
- **[Java agent compatibility]**: Java agents still use old env vars. **Mitigation**: Out of scope, deferred.

---

### f) Testing

#### Backend Unit Tests
- [ ] `backend/src/__tests__/providerController.test.js` — CREATED: root-level CRUD, deprecation responses
- [ ] `backend/src/__tests__/agentService.test.js` — EXTENDED: `create()` with `providerId` validation
- [ ] `backend/src/__tests__/providerService.test.js` — EXTENDED: `resolveProvider()` without `projectId`

#### Backend Integration Tests
- [ ] `backend/src/__tests__/integration/providerRoutes.test.js` — CREATED: full HTTP lifecycle for new routes
- [ ] Bash integration: `backend/integration-test/suites/providers.test.sh` — CREATED: curl tests for new routes + deprecation

#### Frontend Unit Tests
- [ ] `frontend/src/__tests__/providersApi.test.ts` — EXTENDED: functions without `projectId`
- [ ] `frontend/src/__tests__/agentModal.test.js` — EXTENDED: provider selector renders and submits
- [ ] `frontend/src/__tests__/providersPage.test.ts` — CREATED: Providers page renders, creates, edits, deletes

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — EXTENDED: response shapes for provider endpoints
- [ ] `frontend/src/api/validator.ts` — UPDATE: if response shapes changed

---

### g) Migration Notes

Migration: `backend/src/migrations/032_global_providers.sql`
- Creates `providers` table
- Adds `provider_id` to `agents`
- Migrates data from `project_providers`
- Creates indexes

Rollback: `backend/src/migrations/032_global_providers_rollback.sql`
- Drops `providers` table
- Removes `provider_id` from `agents`

Applied in position: after 031 in `backend/src/migrations/apply.js`

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/032_global_providers.sql           → CREATE
backend/src/migrations/032_global_providers_rollback.sql  → CREATE
backend/src/migrations/apply.js                           → MODIFY (add 032)
backend/src/api/providers.js                              → MODIFY (remove projectId, add deprecation)
backend/src/controllers/providerController.js             → MODIFY (use providers table)
backend/src/services/ProviderService.js                   → MODIFY (resolveProvider without projectId)
backend/src/services/AgentService.js                      → MODIFY (accept providerId)
backend/src/api/agents.js                                 → MODIFY (accept providerId in body)
backend/src/api/v1/index.js                               → MODIFY (update route mount)
```

**Frontend:**
```
frontend/src/api/providers.ts       → MODIFY (remove projectId)
frontend/src/api/agents.ts          → MODIFY (add providerId)
frontend/src/views/Providers.vue    → CREATE (new page)
frontend/src/router/index.ts        → MODIFY (add /providers route)
frontend/src/App.vue                → MODIFY (add Providers nav link)
frontend/src/components/AgentModal.vue → MODIFY (add provider selector)
frontend/src/views/ProjectDetail.vue    → MODIFY (remove Providers tab)
```

**Tests:**
```
backend/src/__tests__/providerController.test.js     → CREATE
backend/src/__tests__/agentService.test.js           → EXTEND
backend/src/__tests__/providerService.test.js        → EXTEND
backend/src/__tests__/integration/providerRoutes.test.js → CREATE
backend/integration-test/suites/providers.test.sh    → CREATE
frontend/src/__tests__/providersApi.test.ts          → EXTEND
frontend/src/__tests__/agentModal.test.js            → EXTEND
frontend/src/__tests__/providersPage.test.ts         → CREATE
frontend/src/__tests__/api-contract.test.ts          → EXTEND
frontend/src/api/validator.ts                        → UPDATE (if shapes changed)
```

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `patch`, `del` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts`
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts`
- [ ] Bash integration suite test added for API changes
- [ ] Coverage threshold enforced: backend ≥60%, frontend ≥60%

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes
3. [ ] Backend: `cd backend && bash integration-test/run.sh --only` passes
4. [ ] Backend: `npm run lint` passes
5. [ ] Backend: `npm run test:coverage` passes (60% min)
6. [ ] Frontend: `npm run lint` passes
7. [ ] Frontend: `npm run typecheck` passes
8. [ ] Frontend: `npm run build` passes
9. [ ] Frontend: `npm test -- --run --coverage` passes (60% min)
10. [ ] `GET /api/v1/providers` returns providers list
11. [ ] `POST /api/v1/providers` creates a provider
12. [ ] Old `GET /api/:projectId/providers` returns 410 GONE
13. [ ] `/providers` page loads in browser
14. [ ] AgentModal shows provider dropdown
15. [ ] Providers tab no longer visible in ProjectDetail

---

*Fill in all sections before starting implementation. Update status as work progresses.*
