# bp-41: Per-Ticket Model Routing (Phase 15)

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both (backend + agent)
**Priority**: P2
**Effort**: Medium

## Problem Statement

Currently, every ticket is processed by the project's default AI provider model regardless of complexity, type, or priority. A simple typo fix ("change 'teh' to 'the'") uses the same expensive Claude/GPT-4o call as a complex architecture redesign. This wastes money on cheap tickets and produces poor results on complex ones when using a single cheap model. There is no routing mechanism to match ticket characteristics to the appropriate AI model.

## Scope

- **In scope**: Routing rules schema on provider_configs, ProviderService.resolveProvider() method, backend API endpoint for agent to resolve provider, agent integration to call resolve endpoint at ticket pickup
- **Out of scope**: ML-based complexity estimation, cost tracking per-model, A/B model comparison, automatic rule suggestion

## Acceptance Criteria

- [ ] Backend: ProviderService.resolveProvider(projectId, ticket) evaluates routing_rules top-to-bottom, returns { provider, endpoint_url, model, api_key }
- [ ] Backend: `POST /api/v1/projects/:id/provider/resolve` endpoint accepts ticket info, returns resolved provider config
- [ ] Backend: If routing_rules column doesn't exist on provider_configs, migration 028 adds it
- [ ] Backend: If matched provider fails → retry with fallback provider from routing rules
- [ ] Backend: If no rules match → return project's default provider
- [ ] Agent: At ticket pickup, calls POST /api/v1/projects/:id/provider/resolve with ticket metadata
- [ ] Agent: Uses resolved provider config instead of project default / env vars for AI call

## Known Unknowns

- **Provider credential scope**: The resolved provider's API key must be available. Current `project_providers` table stores encrypted keys per row. The resolved provider row will have its own key.
- **Model fallback chain depth**: We support one fallback. Multi-level fallback is overengineering.

## Decisions Required

1. **Where to store routing_rules?**
   - Option A: JSONB column on project_providers table (each provider config row has its own routing_rules)
   - Option B: New routing_rules table with project_id FK
   - **Recommendation**: Option A — simpler, matches the existing provider config pattern. One project has one provider config with routing rules.

2. **How does agent use resolved config?**
   - Option A: Agent receives full provider config (endpoint_url, model, api_key) and uses it directly
   - Option B: Agent receives a provider ID and fetches the config itself
   - **Recommendation**: Option A — server resolves everything, agent just uses it. Simpler agent logic.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/028_routing_rules.sql` | CREATE | Add routing_rules JSONB to project_providers |
| `backend/src/services/ProviderService.js` | MODIFY | Add resolveProvider() with rule evaluation |
| `backend/src/api/providers.js` | MODIFY | Add POST /:projectId/provider/resolve endpoint |
| `agent/.../ApiService.java` | MODIFY | Add resolveProvider() method |
| `agent/.../TicketProcessor.java` | MODIFY | Call resolve at pickup, use resolved config |

## Dependencies

- **Depends on**: bp-29 (Provider Config) — the provider_configs table must exist
- **Depends on**: bp-25 (AI_ENDPOINT_URL) — the OpenAI-compatible adapter must work with resolved endpoint_url

## Performance Considerations

- resolveProvider() is a simple DB read + in-memory rule evaluation — negligible latency (~1-5ms)
- Rules are evaluated as JSONB operations in Node.js, not in SQL — keeps SQL simple
- Fallback retry adds one extra AI call latency on failure
