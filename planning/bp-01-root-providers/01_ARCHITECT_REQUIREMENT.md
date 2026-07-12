# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-12
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Frontend | Database
**Priority**: P1
**Effort**: Large

---

## Requirement

Currently, AI providers (Ollama, OpenAI, Claude, etc.) are configured **per-project**. This is wrong. Providers are a **global resource** — they represent your AI infrastructure (API keys, endpoints, models) that any agent can use.

The correct flow should be:
1. **Configure providers globally** (root level, not per-project) — set up Ollama, OpenAI, Claude, etc.
2. **Create agents manually** via the Java client — each agent connects to the backend with an API key
3. **Assign a provider to each agent** — when an agent is created/configured, select which AI provider it should use to execute work

This decouples infrastructure (providers) from compute (agents) and makes providers reusable across projects and agents.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Provider API exists: `backend/src/api/providers.js` — routes scoped to `:projectId/providers`
- [x] ProviderController exists: `backend/src/controllers/providerController.js` — all methods use `projectId`
- [x] ProviderService exists: `backend/src/services/ProviderService.js` — `resolveProvider(projectId, ...)`
- [x] ProviderRouter exists: `backend/src/providers/` — provider implementations
- [x] Agent API exists: `backend/src/api/agents.js` — CRUD for agents
- [x] AgentService exists: `backend/src/services/AgentService.js` — no provider reference
- [x] Agents table exists: `agents` — no `provider_id` column
- [x] Project providers table exists: `project_providers` — has `project_id` column

### Frontend API Client Check
- [x] Provider API client exists: `frontend/src/api/providers.ts` — all functions take `projectId`
- [x] Agent API client exists: `frontend/src/api/agents.ts` — no provider reference
- [x] AgentModal exists: `frontend/src/components/AgentModal.vue` — only name input
- [x] Providers tab exists: `frontend/src/views/ProjectDetail.vue` lines 558-685

### Frontend UI Check
- [x] ProjectDetail.vue has a Providers tab — needs to be removed
- [x] No root-level providers page exists — needs to be created
- [x] AgentList.vue exists — needs provider selector in AgentModal

### Integration Check
- [x] Provider resolution (`ProviderService.resolveProvider`) depends on per-project providers — needs redesign
- [x] Java agent config already has `AI_PROVIDER` env var — but not tied to DB provider
- [x] PoolManager passes `AI_API_KEY`, `AI_ENDPOINT_URL`, `AI_MODEL` as env vars — needs to resolve from provider instead

### Key Insight

This is a **database migration + both frontend and backend** task. The core change is:
- `project_providers` → global providers (remove `project_id`)
- `agents` → add `provider_id` FK
- Provider routes change from `/providers/:projectId/providers` to `/providers` (root level)
- Agent creation needs a provider selector
- Providers tab moves from ProjectDetail to a root-level page

---

## Scope

### In Scope
- [x] Database migration: remove `project_id` from `project_providers`, add `provider_id` to `agents`
- [x] Backend API: change provider routes from per-project to root-level
- [x] Backend API: add `provider_id` to agent creation/reading
- [x] Backend: update `ProviderService.resolveProvider` to work with global providers
- [x] Frontend: create root-level Providers management page
- [x] Frontend: remove Providers tab from ProjectDetail.vue
- [x] Frontend: add provider selector to AgentModal.vue
- [x] Frontend: update API clients for new route shapes
- [x] Tests: backend unit + integration, frontend unit + contract

### Out of Scope
- [ ] Java agent changes (env var resolution from provider) — deferred to follow-up ticket
- [ ] PoolManager changes (resolve provider config at container spawn time) — deferred
- [ ] Billing changes (usage attribution to global providers) — deferred
- [ ] Migration of existing data from per-project to global — TBD in design
- [ ] Provider routing rules rework — keep existing JSONB structure

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/032_global_providers.sql` | CREATE | New migration: remove project_id from providers, add provider_id to agents |
| `backend/src/migrations/032_global_providers_rollback.sql` | CREATE | Rollback SQL |
| `backend/src/api/providers.js` | MODIFY | Remove `:projectId` prefix from all routes |
| `backend/src/controllers/providerController.js` | MODIFY | Remove `projectId` from all methods, resolve globally |
| `backend/src/services/ProviderService.js` | MODIFY | `resolveProvider` no longer takes projectId |
| `backend/src/services/AgentService.js` | MODIFY | Accept `provider_id` on create, validate it exists |
| `backend/src/api/agents.js` | MODIFY | Accept `provider_id` in create request |
| `backend/src/api/v1/index.js` | MODIFY | Update provider route mount (no projectId param) |
| `frontend/src/api/providers.ts` | MODIFY | Remove `projectId` from all function signatures |
| `frontend/src/api/agents.ts` | MODIFY | Add `providerId` to createAgent |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Remove Providers tab |
| `frontend/src/views/Providers.vue` | CREATE | New root-level providers management page |
| `frontend/src/components/AgentModal.vue` | MODIFY | Add provider selector dropdown |
| `frontend/src/router/index.ts` | MODIFY | Add `/providers` route |
| `frontend/src/App.vue` | MODIFY | Add Providers nav link |

---

## Known Unknowns

1. **Existing provider data**: Users may already have per-project providers. Should we:
   - Keep `project_providers` as a legacy table and create a new `providers` table? (safe, dual-table)
   - Migrate `project_providers` data into a new `providers` table and drop `project_id`? (cleaner, riskier)
   - **Assumption**: Create a new `providers` table, leave `project_providers` as deprecated (return 410 GONE on old routes). This is the safest approach.

2. **Agent-provider cardinality**: One agent → one provider, or one agent → multiple providers?
   - **Assumption**: One agent → one primary provider. Agents can potentially use fallback providers later.

3. **Where does the Providers UI live?**: Dashboard, new top-level page, or Super Admin?
   - **Assumption**: New top-level page at `/providers`, visible to `project_admin` and `super_admin` roles.

---

## Important Design Decisions

**DECISION POINT 1 — Existing data migration strategy:**

Option A: New `providers` table, keep `project_providers` as deprecated (410 GONE). Cleanest separation.
Option B: Alter `project_providers` in place — remove `project_id`, make global. Risky if any code still references it.
Option C: Create `providers` table AND migrate existing `project_providers` rows into it. Best of both worlds.

**Recommendation**: Option C — create new `providers` table, copy existing `project_providers` rows into it (deduplicating by name+provider_type), then deprecate old routes.

**DECISION POINT 2 — Agent-provider relationship:**

Option A: One provider per agent (simple, `provider_id` FK on agents table).
Option B: Many-to-many (agent_provider junction table, more flexible).

**Recommendation**: Option A — one primary provider per agent. Fallback providers can be added later.

---

## Acceptance Criteria

1. [ ] [DB] New `providers` table created with all fields from `project_providers` minus `project_id`
2. [ ] [DB] `agents` table has `provider_id` column (FK to `providers.id`, nullable)
3. [ ] [DB] Existing `project_providers` data migrated to `providers` (deduplicated)
4. [ ] [Backend] `GET /api/v1/providers` returns all providers (no projectId in URL)
5. [ ] [Backend] `POST /api/v1/providers` creates a global provider
6. [ ] [Backend] `PATCH /api/v1/providers/:id` updates a provider
7. [ ] [Backend] `DELETE /api/v1/providers/:id` deletes a provider
8. [Backend] Old `/api/:projectId/providers` routes return 410 GONE
9. [Backend] `POST /api/v1/agents/create` accepts `provider_id` field
10. [Backend] `GET /api/v1/agents` returns agents with their provider info
11. [Backend] `ProviderService.resolveProvider()` works with global providers (no projectId)
12. [Frontend] New `/providers` page exists with full CRUD for providers
13. [Frontend] Providers tab removed from ProjectDetail.vue
14. [Frontend] AgentModal has a dropdown to select a provider
15. [Frontend] API clients updated for new route shapes
16. [Frontend] Nav link to /providers added to App.vue
17. [Tests] Backend unit tests pass for new provider/agent behavior
18. [Tests] Backend integration tests pass for new routes
19. [Tests] Frontend unit tests pass for updated components
20. [Tests] Contract tests pass for response shape changes
21. [Tests] Bash integration suite passes
22. [Coverage] Backend ≥60%, Frontend ≥60%

---

## Out of Scope

- Java agent changes (env var resolution from provider config)
- PoolManager provider resolution at spawn time
- Billing attribution to global providers
- Multi-provider agents (one agent, multiple providers)
- Provider health checking / auto-failover

---

## Performance Considerations

- Provider lookups are infrequent (config-time, not request-time hot path)
- No pagination needed for providers (typically < 10)
- Agent list with provider info: JOIN on providers table, small result set

---

## Security Considerations

- [x] Provider CRUD requires `project_admin` or `super_admin` permissions
- [x] Agent creation requires `AGENT_CREATE` permission
- [x] Provider API keys remain encrypted in DB (existing pattern)
- [x] Old per-project routes return 410 GONE (not 404) to signal deprecation
- [x] Agent cannot reference a non-existent provider_id (FK constraint)

---

## Testing Checklist

### Test-First Requirement
- [ ] Empty test stub files created BEFORE any production code
- [ ] Test stubs contain imports, `describe` blocks, and stub `it` blocks

### Backend Tests
- [ ] ProviderController tests — new root-level CRUD endpoints
- [ ] AgentService tests — provider_id validation on create
- [ ] ProviderService tests — resolveProvider with global providers
- [ ] Migration tests — verify data migration correctness
- [ ] Bash integration suite — new provider routes

### Frontend Tests
- [ ] Provider API client tests — updated function signatures
- [ ] AgentModal tests — provider selector renders and submits
- [ ] Providers page tests — renders, creates, edits, deletes
- [ ] Contract tests — response shapes updated

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend ≥60%
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash suite passes
- [ ] `npm run lint` — no lint errors (both backend and frontend)
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run --coverage` — frontend ≥60%

---

## Anti-Patterns to Avoid

- ❌ **Altering `project_providers` in place** — create new `providers` table instead
- ❌ **Dropping old routes without 410 GONE** — signal deprecation properly
- ❌ **Hardcoding provider IDs** — resolve dynamically
- ❌ **Skipping data migration** — existing providers must be preserved
- ❌ **Creating new API clients from scratch** — follow existing patterns
- ❌ **Ignoring the Providers tab in ProjectDetail** — must be removed
- ❌ **Testing only happy paths** — test error cases, empty states, loading states
- ❌ **Skipping the bash integration suite** — required for all backend API changes
- ❌ **Skipping coverage threshold** — CI enforces 60% min

---

*Fill in all sections before starting implementation.*
