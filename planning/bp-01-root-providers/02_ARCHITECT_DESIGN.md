# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend | Frontend | Database
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

AI providers are currently scoped per-project (`project_providers` table), but providers represent **global infrastructure** — API keys, endpoints, and model configurations for Ollama, OpenAI, Claude, etc. They should be configured once and reused by any agent across any project.

Additionally, agents have no connection to providers. An agent should declare which provider it uses to execute AI work.

---

## Current State

### Existing Backend
- **Table**: `project_providers` — has `project_id` FK, scoped per project
- **Routes**: `GET/POST/PATCH/DELETE /:projectId/providers` — all scoped to project
- **Controller**: `providerController.js` — all methods extract `projectId` from URL
- **Service**: `ProviderService.resolveProvider(projectId, ticketInfo)` — resolves provider by project
- **Agent routes**: `/agents/create`, `/agents`, `/agents/:id` — no provider reference
- **Agents table**: no `provider_id` column

### Existing Frontend
- **Providers tab**: in `ProjectDetail.vue` (lines 558-685) — CRUD per project
- **API client**: `frontend/src/api/providers.ts` — all functions take `projectId`
- **AgentModal**: only name input — no provider selection
- **No root-level providers page** exists

### Gap Analysis
- Providers are per-project but should be global
- No UI to manage global providers
- Agents have no provider association
- Old routes use `:projectId` prefix that must be removed/replaced

---

## Design

### Strategy: New `providers` table, deprecate `project_providers`

We create a new `providers` table (global, no `project_id`) and migrate existing data. The old `project_providers` table and routes are deprecated (return 410 GONE). This is safer than altering the existing table in place because:

1. Other code may reference `project_providers` (migrations, queries)
2. Zero risk of breaking existing queries during migration
3. Clean separation: old table stays until explicitly dropped in a future ticket

### Database Schema

#### New table: `providers` (migration 032)

```sql
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

-- Deduplication constraint: same name + type can only exist once
ALTER TABLE providers ADD CONSTRAINT unique_provider_name_type UNIQUE (name, provider_type);
```

Fields carried over from `project_providers`: `name`, `provider_type`, `api_key_encrypted`, `base_url`, `model`, `roles`, `max_tokens`, `temperature`, `endpoint_url`, `fallback_provider`, `routing_rules`, `is_project_director`, `is_active`, timestamps.

Removed: `project_id` (now global).

#### Migration: Add `provider_id` to `agents` (migration 032)

```sql
ALTER TABLE agents ADD COLUMN IF NOT EXISTS provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL;
```

Nullable so existing agents without a provider still work.

#### Data migration

```sql
-- Copy distinct providers from project_providers to providers
-- Deduplicate by (name, provider_type), keep the first occurrence
INSERT INTO providers (name, provider_type, api_key_encrypted, base_url, model, roles,
                       max_tokens, temperature, endpoint_url, fallback_provider, routing_rules,
                       is_project_director, is_active, created_at, updated_at)
SELECT DISTINCT ON (name, provider_type)
  name, provider_type, api_key_encrypted, base_url, model, roles,
  max_tokens, temperature, COALESCE(endpoint_url, NULL), fallback_provider,
  routing_rules, is_project_director, is_active, created_at, updated_at
FROM project_providers
WHERE is_active = true
ORDER BY name, provider_type, created_at ASC;
```

### Backend API Changes

#### New routes: root-level `/providers`

```
GET    /api/v1/providers              → listProviders (all providers)
POST   /api/v1/providers              → addProvider (create global)
GET    /api/v1/providers/:id          → getProvider (single)
PATCH  /api/v1/providers/:id          → updateProvider
DELETE /api/v1/providers/:id          → deleteProvider
POST   /api/v1/providers/:id/test     → testProvider
PATCH  /api/v1/providers/:id/directorate → setDirector
GET    /api/v1/providers/:id/agents   → list agents using this provider
```

#### Deprecated routes: old per-project `/providers`

All old routes (`/:projectId/providers*`) return `410 Gone` with a message:
```json
{ "success": false, "error": { "code": "DEPRECATED", "message": "Providers are now global. Use /api/v1/providers instead." } }
```

#### Agent creation: accept `provider_id`

```
POST /api/v1/agents/create
Body: { name: string, providerId?: number }
```

Validate `providerId` exists in `providers` table if provided.

#### ProviderService.update

`resolveProvider(ticketInfo)` — no longer takes `projectId`. Resolves from global providers using routing rules. First provider with matching role is used.

### Frontend Changes

#### New page: `/providers` — Providers.vue

A root-level page with full provider CRUD. Mirrors the current Providers tab UI but at the top level.

Structure:
- Header: "AI Providers" + "Add Provider" button
- Provider cards (same as current tab): name, type, model, actions (edit, delete, test)
- Add/Edit modal (same as current form)
- Director badge showing which provider is the default

#### Remove: Providers tab from ProjectDetail.vue

- Remove `'providers'` from tabs array
- Remove provider panel div and all provider-related state refs
- Remove `loadProviders()`, `handleAddProvider()`, etc. functions
- Remove provider-related CSS

#### Update: AgentModal.vue

Add a provider selector dropdown:
```vue
<select v-model="newAgent.providerId">
  <option :value="null">Select a provider...</option>
  <option v-for="p in providers" :key="p.id" :value="p.id">
    {{ p.name }} ({{ p.provider_type }})
  </option>
</select>
```

Load providers on mount via `listProviders()`.

#### Update: API clients

- `providers.ts`: remove `projectId` from all functions
- `agents.ts`: add `providerId` to `createAgent(name, providerId?)`

#### Update: Router

Add `/providers` route to `frontend/src/router/index.ts`.

#### Update: Nav

Add "Providers" link to `App.vue` nav bar (visible to `project_admin` + `super_admin`).

### Data Flow Diagram

```
[User] → [Providers Page] → [listProviders()] → [GET /api/v1/providers] → [ProviderController] → [providers table]
  ↑          ↓
[Response] ← [Error handling]

[User] → [AgentModal] → [createAgent(name, providerId)] → [POST /api/v1/agents/create]
  → [AgentController] → [AgentService.create(name, apiKey, userId, providerId)]
  → [agents INSERT with provider_id] → [Response with generatedApiKey]
```

### Error Handling Strategy

Same as existing patterns:
- Missing auth → 401
- Insufficient permissions → 403
- Invalid input → 400 (Joi validation)
- Provider not found → 404
- Duplicate name+type → 409
- Deprecated route access → 410

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/032_global_providers.sql` | CREATE | New `providers` table, add `provider_id` to `agents`, migrate data |
| `backend/src/migrations/032_global_providers_rollback.sql` | CREATE | Drop `providers`, remove `provider_id` from `agents`, restore old data |
| `backend/src/migrations/apply.js` | MODIFY | Add 032 to SQL_FILES array |
| `backend/src/api/providers.js` | MODIFY | Remove `:projectId` prefix, add deprecation stubs, add `/:id/agents` route |
| `backend/src/controllers/providerController.js` | MODIFY | Remove `projectId` from all methods, add deprecation responses |
| `backend/src/services/ProviderService.js` | MODIFY | `resolveProvider` no longer takes `projectId` |
| `backend/src/services/AgentService.js` | MODIFY | Accept `providerId` in `create()`, validate against `providers` table |
| `backend/src/api/agents.js` | MODIFY | Accept `providerId` in create request body |
| `backend/src/api/v1/index.js` | MODIFY | Update provider route mount |
| `frontend/src/api/providers.ts` | MODIFY | Remove `projectId` from all function signatures |
| `frontend/src/api/agents.ts` | MODIFY | Add `providerId` to `createAgent` |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Remove Providers tab, state, functions, CSS |
| `frontend/src/views/Providers.vue` | CREATE | New root-level providers management page |
| `frontend/src/components/AgentModal.vue` | MODIFY | Add provider selector dropdown |
| `frontend/src/router/index.ts` | MODIFY | Add `/providers` route |
| `frontend/src/App.vue` | MODIFY | Add Providers nav link |

---

## Dependencies

### Backend Dependencies
- `providers` table (new)
- `agents` table (add column)
- `project_providers` table (read-only during migration, then deprecated)
- Existing provider implementations (`providers/` directory) — no changes needed
- Existing auth/permissions middleware — no changes needed

### Frontend Dependencies
- Existing API client pattern (`get`, `post`, `patch`, `del` from `./client`)
- Existing modal component pattern (`AgentModal.vue`)
- Existing tab/page pattern (`ProjectDetail.vue` as reference for Providers page)
- Auth store for permission checks

### Cross-Cutting Dependencies
- OpenAPI spec regeneration after route changes
- Contract test updates for response shape changes
- Response validation (`validator.ts`) if shapes change

---

## Config / Environment Changes

- [ ] No new environment variables
- [ ] No new npm dependencies
- [ ] Existing `AI_PROVIDER` env var in Java agent config remains compatible (deferred)

---

## Database Changes

### New Table: `providers`

```sql
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
```

### New Column: `agents.provider_id`

```sql
ALTER TABLE agents ADD COLUMN IF NOT EXISTS provider_id BIGINT REFERENCES providers(id) ON DELETE SET NULL;
```

### Data Migration

```sql
INSERT INTO providers (name, provider_type, api_key_encrypted, base_url, model, roles,
                       max_tokens, temperature, endpoint_url, fallback_provider, routing_rules,
                       is_project_director, is_active, created_at, updated_at)
SELECT DISTINCT ON (name, provider_type)
  name, provider_type, api_key_encrypted, base_url, model, roles,
  max_tokens, temperature, COALESCE(endpoint_url, NULL), fallback_provider,
  routing_rules, is_project_director, is_active, created_at, updated_at
FROM project_providers
WHERE is_active = true
ORDER BY name, provider_type, created_at ASC;
```

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_agents_provider_id ON agents(provider_id);
```

### Migrations
- [ ] Migration `032_global_providers.sql` — create providers, add provider_id to agents, migrate data, create indexes
- [ ] Rollback `032_global_providers_rollback.sql` — drop providers, remove provider_id from agents, restore from backup

---

## Security Considerations

- [x] Provider CRUD requires authentication (`verifyToken`)
- [x] Provider creation requires `project_admin` or `super_admin` role
- [x] Provider API keys remain encrypted (existing `encryptKey`/`decryptKey` pattern)
- [x] Agent `provider_id` validated against `providers` table (FK constraint)
- [x] Old per-project routes return 410 GONE (not 404) to signal deprecation
- [x] No SQL injection (parameterized queries via pg)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/` | ProviderController, AgentService, ProviderService |
| Backend integration | Jest + real PG | `backend/src/__tests__/integration/` | HTTP→DB lifecycle |
| Bash integration | curl | `backend/integration-test/suites/` | New provider routes, deprecation |
| Frontend unit | Vitest | `frontend/src/__tests__/` | API clients, AgentModal, Providers page |
| Contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Response shapes |

### Backend Unit Tests
- ProviderController: CRUD for root-level providers
- ProviderController: deprecation responses for old routes
- AgentService: `create()` with valid/invalid `providerId`
- ProviderService: `resolveProvider()` with global providers (no projectId)

### Frontend Unit Tests
- Provider API client: all functions work without `projectId`
- AgentModal: provider dropdown renders, selects, submits
- Providers page: renders, creates, edits, deletes providers

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: Other code references `project_providers` directly (not through API). **Mitigation**: Leave `project_providers` table intact; only deprecate API routes.
- **[Risk]**: Migration data loss if `project_providers` has corrupted data. **Mitigation**: Only migrate `is_active = true` rows; log skipped rows.

### Frontend Risks
- **[Risk]**: Removing Providers tab from ProjectDetail.vue breaks users who bookmarked that tab. **Mitigation**: Redirect `/projects/:id/providers` to `/providers`.
- **[Risk]**: Provider selector in AgentModal loads providers async. **Mitigation**: Show loading state, handle empty list gracefully.

### Integration Risks
- **[Risk]**: Java agents still reference `project_providers` via old API. **Mitigation**: Old routes return 410 GONE with redirect hint; Java agent changes are out of scope (deferred).
- **[Risk]**: PoolManager creates containers with per-project provider config. **Mitigation**: PoolManager changes deferred to follow-up ticket.

### Edge Cases
- [ ] **Duplicate provider names**: `UNIQUE(name, provider_type)` constraint prevents this
- [ ] **Agent created without provider**: `provider_id` is nullable, agent works without one
- [ ] **Provider deleted while agents reference it**: `ON DELETE SET NULL` — agent's `provider_id` becomes null
- [ ] **Empty providers list**: Provider dropdown shows "Select a provider..." placeholder
- [ ] **Migration runs twice**: `CREATE TABLE IF NOT EXISTS` and `INSERT ... ON CONFLICT DO NOTHING` handle idempotency

---

## Alternative Designs Considered

### Alternative 1: Alter `project_providers` in place

Remove `project_id` column from the existing table instead of creating a new one.

- **Pros**: Simpler migration, no new table
- **Cons**: Risk of breaking existing queries that reference `project_providers`; harder rollback; no clean separation between old and new
- **Decision**: Not chosen. Creating a new `providers` table is safer and cleaner.

### Alternative 2: Many-to-many agent-provider relationship

Use a junction table `agent_providers` so agents can have multiple providers.

- **Pros**: More flexible, agents can use multiple AI backends
- **Cons**: Over-engineering for current needs; adds complexity to agent spawn logic
- **Decision**: Not chosen. One provider per agent is sufficient for now. Can add many-to-many later.

### Alternative 3: Keep per-project providers, add global fallback

Add a `global_providers` table alongside `project_providers`, with a fallback resolution order (project → global).

- **Pros**: Backward compatible, gradual migration
- **Cons**: Adds complexity to provider resolution; two tables to maintain; confusing for users
- **Decision**: Not chosen. Full migration to global providers is cleaner long-term.

---

*This design document guides implementation. The "New providers table" approach is the chosen strategy — it's the safest path that preserves existing data while enabling the new global model.*
