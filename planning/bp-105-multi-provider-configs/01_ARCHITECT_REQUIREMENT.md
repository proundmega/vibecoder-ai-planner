# 01_ARCHITECT_REQUIREMENT.md — Multi-Provider Configs per Project

**Status**: planned
**Date created**: 2025-07-24
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P3 (Security)
**Effort**: Medium

---

## Requirement

Currently, the system supports a single global provider with routing rules. Operators need the ability to create multiple named provider configurations per project (e.g., "gpt-4 for production", "claude for staging") and select which one to use for each project.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Provider service: `backend/src/services/ProviderService.js` — single global provider via `getGlobalProvider()`
- [x] Provider API: `backend/src/api/providers.js` — CRUD for providers, `/resolve` endpoint
- [x] Routing rules: `ProviderService.resolveProvider()` — matches tickets to providers via labels/priority
- [x] Providers table: has `is_project_director`, `routing_rules`, `provider_type`, `api_key_encrypted`

### Key Insight

The current architecture already supports routing rules within a single provider. Multi-provider support means:
1. Allowing multiple active providers (not just one `is_project_director`)
2. Adding a `project_id` column to link providers to projects
3. Updating `resolveProvider()` to check project-scoped providers first, then fall back to global

---

## Scope

### In Scope
- Add `project_id` column to `providers` table (migration)
- Update `ProviderService.getGlobalProvider()` to also return project-scoped providers
- Update `ProviderService.resolveProvider()` to check project-scoped providers first
- Add `GET /providers?project_id=X` filter to list endpoint
- Tests: verify multi-provider resolution

### Out of Scope
- UI for selecting provider per project (frontend work — separate ticket)
- Provider rotation/failover beyond routing rules
- Per-ticket provider selection (routing rules handle this)
- Provider usage tracking per config

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/XXX_add_project_id_to_providers.sql` | CREATE | Add project_id column |
| `backend/src/services/ProviderService.js` | MODIFY | Support project-scoped providers |
| `backend/src/api/providers.js` | MODIFY | Add project_id filter |
| `backend/src/__tests__/providerService.test.js` | MODIFY | Add multi-provider tests |

---

## Acceptance Criteria

1. [ ] Providers table supports `project_id` (nullable — null = global)
2. [ ] `resolveProvider()` checks project-scoped providers first
3. [ ] Project-scoped providers override global provider
4. [ ] `GET /providers?project_id=X` filters by project
5. [ ] Global provider still works when no project-scoped providers exist
6. [ ] All existing provider tests still pass
7. [ ] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- UI for selecting provider per project
- Provider rotation/failover
- Per-ticket provider selection
- Provider usage tracking per config

---

## Performance Considerations

- Adding `project_id` index on `providers` table for efficient filtering
- Query change: `WHERE (project_id = $1 OR project_id IS NULL) AND is_active = true`
- No N+1 queries — single query returns all relevant providers

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: verify project-scoped provider resolution
- [ ] Unit tests: verify global provider fallback
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
