# bp-29: Per-Project AI Provider Config + ProviderService

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both
**Priority**: P1
**Effort**: Medium

## Problem Statement

AI provider configuration is tied to the agent instance (env vars), not the project. A single agent runs one model for all tickets. You can't route different projects to different models, and you can't store API keys in the credential system. Local models (Ollama/vLLM) have no configuration path at all.

## Scope

- **In scope**: `provider_configs` table (project_id, provider, endpoint_url, model, api_key_ref, fallback_provider), ProviderService, provider config UI tab in ProjectDetail.vue, agent fetches config per project
- **Out of scope**: Per-ticket model routing, fallback logic, pool manager integration

## Acceptance Criteria

- [ ] Migration creates `provider_configs` table with JSONB for routing rules
- [ ] Backend API: CRUD for project provider configs
- [ ] ProviderService.getConfig(projectId) returns current config
- [ ] ProviderService.testConnection(config) tries a completion and returns success/fail
- [ ] Agent fetches provider config per project at startup instead of env vars
- [ ] Agent supports local model endpoint URLs from project config
- [ ] Frontend: Provider config tab in ProjectDetail.vue

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/020_provider_configs.sql` | CREATE | provider_configs table |
| `backend/src/services/ProviderService.js` | CREATE | Config CRUD + test connection |
| `backend/src/api/providers.js` | MODIFY | Add project-specific endpoints |
| `frontend/src/api/providers.js` | MODIFY/CHECK | Ensure API client exists |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add "AI Provider" tab |
| `agent/src/.../AgentConfig.java` | MODIFY | Fetch config from API instead of env |
| `agent/src/.../TicketProcessor.java` | MODIFY | Pass project config to provider |

## Dependencies

- **Depends on**: bp-25 (OpenAI-compatible adapter — needed for local model URLs)
- **Depends on this**: bp-30 (diagnostics tests AI provider check)
