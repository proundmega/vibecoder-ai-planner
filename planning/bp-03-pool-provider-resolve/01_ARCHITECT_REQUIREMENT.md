# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Medium

---

## Requirement

PoolManager spawns ephemeral Docker containers for agents. Currently, it passes provider config as raw env vars (`AI_API_KEY`, `AI_ENDPOINT_URL`, `AI_MODEL`) that the caller must shape and provide. This has several problems:

1. **No provider resolution** — PoolManager doesn't know which provider to use; the caller must manually pass `provider_config` with the right keys
2. **Wrong key names** — PoolManager expects `endpoint`, `apiKey`, `model` but ProviderService returns `endpoint_url`, `api_key`, `model`
3. **Missing env vars** — `AI_PROVIDER` (provider type) and `AI_MAX_TOKENS` are never passed, so agents default to `claude` and `4096`
4. **No schema validation** — `provider_config` in the pool route is `Joi.object().optional()` — any shape accepted

After bp-01, providers are global. The pool should resolve the provider automatically (using the project's director provider or a default) and pass the correct env vars to the container.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] PoolManager exists: `backend/src/services/PoolManager.js` — `requestAgent(projectId, repoUrl, providerConfig)`
- [x] Pool route exists: `backend/src/api/pool.js` — accepts `provider_config` from request body
- [x] Pool validator exists: `backend/src/validators/pool.js` — `provider_config: Joi.object().optional()`
- [x] ProviderService exists: `backend/src/services/ProviderService.js` — `resolveProvider(projectId, ticketInfo)`
- [x] Provider routes changed in bp-01 — global, no projectId
- [x] Providers table exists: global (from bp-01)
- [ ] **ProviderService.resolveProvider()** needs update for global providers (no projectId parameter)

### Key Insight

This is a **backend-only** task. PoolManager needs to:
1. Accept `providerId` (or resolve automatically from project's director provider)
2. Fetch provider config from the global `providers` table
3. Pass correct env vars including `AI_PROVIDER` and `AI_MAX_TOKENS`

---

## Scope

### In Scope
- [ ] Backend: `ProviderService.resolveProvider()` — update for global providers (no projectId)
- [ ] Backend: `PoolManager.requestAgent()` — accept `providerId`, resolve config from `providers` table
- [ ] Backend: Pass all provider env vars to containers: `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_ENDPOINT_URL`, `AI_MAX_TOKENS`
- [ ] Backend: Pool route validator — add proper schema for `provider_config`
- [ ] Backend: Pool route — auto-resolve provider if not specified (use project's director or first active provider)
- [ ] Backend: `ProvisioningService.spawnAgent()` — same provider resolution for remote nodes
- [ ] Tests: Update existing pool manager tests for new behavior

### Out of Scope
- [ ] Java agent changes (bp-02)
- [ ] Usage reporting (bp-04)
- [ ] Multi-provider routing in pools (single provider per container)
- [ ] Provider health checking before spawn

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/ProviderService.js` | MODIFY | `resolveProvider()` without projectId, query global providers |
| `backend/src/services/PoolManager.js` | MODIFY | Accept `providerId`, resolve config, pass all env vars |
| `backend/src/api/pool.js` | MODIFY | Auto-resolve provider, pass resolved config to PoolManager |
| `backend/src/validators/pool.js` | MODIFY | Add proper schema for `provider_config` |
| `backend/src/services/ProvisioningService.js` | MODIFY | Same provider resolution for remote spawn |
| `backend/src/__tests__/poolManager.test.js` | MODIFY | Update tests for new env var passing |

---

## Known Unknowns

1. **Pool provider resolution strategy**: When a pool request doesn't specify a provider, which provider should be used?
   - Option A: Use the project's "director" provider (existing `is_project_director` flag)
   - Option B: Use the first active provider with `worker` role
   - **Assumption**: Option B (first active worker provider). Director providers are for orchestration, not worker tasks.

2. **Remote provisioning**: `ProvisioningService.spawnAgent()` SSHes to remote nodes. Should it use the same provider resolution? **Yes** — consistent behavior everywhere.

---

## Important Design Decisions

**DECISION — Pool provider resolution:**

When `provider_config` is not provided in a pool request, the system should auto-resolve:
1. Find the first active provider with `worker` in its `roles` array
2. Use that provider's config for the container env vars
3. If no worker provider found, use the first active provider of any role
4. If no providers found, fail with 400 error

This is simpler than the director concept for pool-spawned ephemeral agents.

---

## Acceptance Criteria

1. [ ] [Backend] `PoolManager.requestAgent()` resolves provider from `providerId` or auto-selects
2. [ ] [Backend] Container env vars include `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_ENDPOINT_URL`, `AI_MAX_TOKENS`
3. [ ] [Backend] Pool route auto-resolves provider when not specified
4. [ ] [Backend] Pool validator has proper schema for `provider_config`
5. [ ] [Backend] `ProviderService.resolveProvider()` works with global providers
6. [ ] [Backend] `ProvisioningService.spawnAgent()` uses same provider resolution
7. [ ] [Tests] Pool manager tests updated for new env var passing

---

## Out of Scope

- Java agent changes (bp-02)
- Usage reporting (bp-04)
- Multi-provider routing
- Provider health checking

---

## Security Considerations

- [x] Provider API key decrypted server-side, passed to container (necessary)
- [x] Pool requests require `PROJECT_ADMIN` permission (existing)
- [x] Provider must be active (`is_active = true`) to be selected
- [x] No PII in env vars

---

## Testing Checklist

### Backend Tests
- [ ] `PoolManager.requestAgent()` passes correct env vars
- [ ] `PoolManager.requestAgent()` with `providerId` uses that provider
- [ ] `PoolManager.requestAgent()` auto-resolves when no provider specified
- [ ] `ProviderService.resolveProvider()` works with global providers
- [ ] Pool route returns 400 when no providers available

---

## Anti-Patterns to Avoid

- ❌ **Altering `project_providers` table** — use global `providers` table from bp-01
- ❌ **Hardcoding provider selection** — query the database
- ❌ **Skipping AI_PROVIDER env var** — agent needs to know the provider type
- ❌ **Skipping AI_MAX_TOKENS env var** — agent defaults to 4096, should use provider config
- ❌ **Duplicating provider resolution logic** — use a shared method
- ❌ **Breaking existing pool tests** — update, don't recreate

---

*Fill in all sections before starting implementation.*
