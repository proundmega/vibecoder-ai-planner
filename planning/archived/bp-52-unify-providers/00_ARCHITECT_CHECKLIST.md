# BP-52: Unify Provider Config & AI Providers

## Pre-Implementation Checklist

- [x] Audit current usage of `provider_configs` table across all files
- [x] Audit current usage of `project_providers` table across all files
- [x] Identify all API endpoints that need merging
- [x] Identify frontend components that need unification
- [x] Identify services/controllers that read from `provider_configs`
- [x] Check if `provider_configs` data is used by agent compute nodes
- [x] Plan migration strategy: add columns to `project_providers` vs create new table
- [x] Plan data migration: should existing `provider_configs` rows be migrated to `project_providers`?
- [x] Identify the "project director" concept — who uses it? (ProviderRouter, ProviderService, agents?)
- [x] Check if `fallback_provider` field in `provider_configs` references another provider by type or by ID
- [x] Verify backward compatibility with existing agents using `provider_configs`
- [x] Check if any existing data in `provider_configs` should become the initial project director

## Audit Findings

### `provider_configs` usage
- **Backend controller**: `providerController.js` — `getProviderConfig`, `setProviderConfig`, `deleteProviderConfig`, `testProviderConnection`
- **Backend service**: `ProviderService.resolveProvider()` — reads `routing_rules` from `provider_configs` (line 22)
- **Backend routes**: `api/providers.js` lines 12-15 — 4 routes (`GET`, `PUT`, `DELETE`, `POST /test`)
- **Frontend API**: `frontend/src/api/providers.js` — `fetchProviderConfig`, `setProviderConfig`, `deleteProviderConfig`, `testProviderConnection`
- **Frontend view**: `ProjectDetail.vue` — "Provider Config" tab (lines 484-536), `providerConfig` ref (line 92)
- **Agent compute nodes**: NOT directly used — agents call `ProviderService.resolveProvider()` via API

### `project_providers` usage
- **Backend controller**: `providerController.js` — `addProvider`, `updateProvider`, `deleteProvider`, `listProviders`, `testProvider`
- **Backend service**: `ProviderService.getProjectProvider()` — `ORDER BY created_at DESC LIMIT 1` (line 9)
- **Backend service**: `ProviderRouter.loadProviders()` — loads all active providers (line 17)
- **Backend routes**: `api/providers.js` — 5 routes (`GET`, `POST`, `PATCH`, `DELETE`, `POST /test`)
- **Frontend API**: `frontend/src/api/providers.js` — `listProviders`, `addProvider`, `updateProvider`, `deleteProvider`, `testProvider`
- **Frontend view**: `ProjectDetail.vue` — "AI Providers" tab (lines 621-698)

### Key observations
- `fallback_provider` in `provider_configs` is a provider **type** string (e.g., 'openai', 'claude'), not a provider ID
- `provider_configs` has `routing_rules` JSONB — `project_providers` does NOT
- `provider_configs` has `api_key_credential_id` (FK to `project_credentials`) — `project_providers` stores encrypted key directly
- `ProviderService.resolveProvider()` checks `config.routing_rules` on line 22 — but `project_providers` rows don't have this field yet
- `ProviderRouter` loads from `project_providers` only — never reads `provider_configs`
- `ProviderService.getProjectProvider()` returns the latest-created provider, not a designated one

### Migration approach
- Extend `project_providers` (not create new table) — it already supports multi-provider, has encryption, has ProviderRouter integration
- Add columns: `endpoint_url`, `fallback_provider`, `routing_rules`, `is_project_director`
- Add partial unique index for single-director constraint
- Deprecate `provider_configs` table (keep for backward compat, mark as deprecated)
- Data migration: if `provider_configs` has rows, create a default provider in `project_providers` and set as director
