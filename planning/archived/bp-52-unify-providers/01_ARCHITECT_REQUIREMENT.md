# BP-52: Unify Provider Config & AI Providers — Requirements

## Problem

Two separate, overlapping views for managing AI providers:
- **Provider Config** (`provider_configs` table): single project-level config with `provider`, `model`, `endpoint_url`, `api_key`, `fallback_provider`, `routing_rules`
- **AI Providers** (`project_providers` table): multiple provider instances with `name`, `provider_type`, `api_key`, `base_url`, `model`, `max_tokens`, `temperature`, `roles`

Users need the full field set from Provider Config (endpoint_url, fallback_provider, routing_rules) when creating providers, but also need to manage multiple providers. The separation is confusing and prevents proper multi-provider workflows.

## Goal

Unify both views into a single "AI Providers" tab where:
1. Users can create/edit/delete multiple LLM connections
2. Each connection has ALL fields: `name`, `provider_type`, `model`, `api_key`, `base_url`, `endpoint_url`, `max_tokens`, `temperature`, `fallback_provider`, `routing_rules`
3. One provider per project is designated as the "Project Director" (the default provider used for ticket processing)
4. Only one provider can be the Project Director per project

## Acceptance Criteria

1. [ ] Single "AI Providers" tab replaces both "Provider Config" and "AI Providers" tabs
2. [ ] Provider creation form includes all fields: name, provider_type, model, api_key, base_url, endpoint_url, max_tokens, temperature, fallback_provider
3. [ ] Each provider card shows all configured fields
4. [ ] User can designate one provider as "Project Director" via a button/action
5. [ ] Only one provider per project can be the Project Director (enforced at DB and API level)
6. [ ] When a provider is set as Project Director, any previously designated director is automatically demoted
7. [ ] Backend API returns all provider fields in list/get/update responses
8. [ ] Existing `provider_configs` data is migrated to `project_providers` during migration
9. [ ] The first provider in `project_providers` (or the one matching existing `provider_configs`) is automatically set as the initial Project Director
10. [ ] `provider_configs` table is deprecated (column marked but not deleted to avoid breaking existing deployments)
11. [ ] ProviderRouter queries the Project Director instead of `provider_configs`
12. [ ] ProviderService.resolveProvider uses the unified provider data
13. [ ] All existing tests pass after migration
14. [ ] Adding a regression test for the "only one director" constraint

## Out of Scope

- Migrating data from `provider_configs` to `project_providers` in the migration script (manual step or skip — existing data is minimal)
- Changing agent compute node code (Java) — agents will query the new API endpoint
- Changing the `roles` array concept (worker, admin, etc.)
