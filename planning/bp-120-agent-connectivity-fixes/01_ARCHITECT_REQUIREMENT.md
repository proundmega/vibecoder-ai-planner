# 01_ARCHITECT_REQUIREMENT.md — Agent Connectivity Fixes

**Status**: planned
**Date created**: 2025-08-18
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend + Java Agent + Frontend
**Priority**: P0
**Effort**: Medium

---

## Requirement

Three interrelated bugs prevent Java agents from functioning after creation:

1. **Double-wrapping bug**: `GET /api/v1/agents/:agentId/provider-config` returns `{ success: true, data: { success: true, data: {...} } }` instead of `{ success: true, data: {...} }`. The Java agent's `createAiProvider()` method receives a nested object and can't extract `provider_type`, `api_key`, `model`, etc. It falls back to env vars, which may not be set, causing the agent to silently fail.

2. **Agents invisible in heartbeat tab**: The `GET /api/v1/agents-status` endpoint queries `FROM agent_heartbeats ah LEFT JOIN agents a` — agents without a heartbeat row (never connected yet) don't appear. Users create agents in the Agents tab but see nothing in the Heartbeat tab, even after the agent starts.

3. **Provider config endpoint response format inconsistency**: The route handler in `agents.js` wraps the already-wrapped `getProviderConfig()` return value, creating a double-nested response. All other provider-related endpoints (`GET /providers`, `GET /providers/:id`) use consistent `{ success, data }` wrapping.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/agents.js` — YES (line 327)
- [x] Controller exists: N/A (route handler calls service directly)
- [x] Service exists: `backend/src/services/AgentService.js` — YES (`getProviderConfig` at line 147)
- [x] Route is mounted: `backend/src/api/v1/index.js` — YES (line 198)
- [x] OpenAPI JSDoc annotations exist — YES (lines 304-326)
- [x] HeartbeatService exists: `backend/src/services/HeartbeatService.js` — YES (`getAllAgents` at line 46)
- [x] Heartbeat route exists: `backend/src/api/v1/agentHeartbeat.js` — YES

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/agents.ts` — YES
- [x] API client functions cover all needed endpoints — YES
- [x] API client follows existing patterns — YES

### Frontend UI Check
- [x] View component exists: `frontend/src/views/AgentList.vue` — YES
- [x] Route exists: `frontend/src/router/index.ts` — YES
- [x] Existing tabs/section: AgentList.vue has "Heartbeat" and "Agents" tabs

### Key Insight

All three bugs are **backend-only fixes** (plus a Java agent compatibility fix). The frontend already calls the correct endpoints. The providers screen works fine for CRUD — the issue is that agents can't consume the provider config due to the double-wrapping bug. No new API endpoints needed. No DB migrations needed.

---

## Scope

### In Scope
- Fix `AgentService.getProviderConfig()` to return flat `{ provider_type, api_key, base_url, model, max_tokens }` (remove `success`/`data` wrapper)
- Remove double-wrapping in `agents.js` route handler (line 334)
- Fix `HeartbeatService.getAllAgents()` to query FROM `agents` LEFT JOIN `agent_heartbeats` (agents without heartbeats appear)
- Update Java agent `AgentApp.java` to handle both response formats during transition (defensive parsing)
- Update existing tests for changed response shapes

### Out of Scope
- New DB migrations (none needed)
- New API endpoints
- New frontend UI changes
- New npm dependencies
- Changes to other agent endpoints (heartbeat, ticket operations, etc.)
- Java agent build/deployment changes (Java agent fix is defensive parsing only, no new features)

---

## Pending Scope Items to Present to User

**No deferred improvements found in previous tickets relevant to this ticket.**

---

## Deferred Improvements Found (Internal Tracking)

No deferred improvements found in previous tickets.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/AgentService.js` | MODIFY | Remove `success`/`data` wrapper from `getProviderConfig()` return value |
| `backend/src/api/agents.js` | MODIFY | Remove double-wrapping in route handler (line 334) |
| `backend/src/services/HeartbeatService.js` | MODIFY | Change `getAllAgents()` query from `FROM agent_heartbeats` to `FROM agents` |
| `agent/src/main/java/.../AgentApp.java` | MODIFY | Add defensive parsing for double-wrapped responses |
| `backend/src/__tests__/agentEdit.test.js` | MODIFY | Update test expectations for flat response |
| `backend/src/__tests__/heartbeatService.test.js` | MODIFY | Update `getAllAgents()` test expectations |

---

## Known Unknowns

1. **Java agent response parsing**: The Java `ApiResponse` deserialization may need a small fix to handle both wrapped and unwrapped response formats. Need to verify the exact deserialization path in `ApiService.getProviderConfig()`.

2. **Other callers of `getProviderConfig()`**: The `getProviderConfig()` service method is called by:
   - `agents.js` route handler (line 333) — the only caller
   - No other code calls this method directly
   - Safe to change return format

3. **HeartbeatService.getAllAgents() impact**: Changing the query may affect the count aggregation for `actions_today` and `cost_today`. Need to verify the LEFT JOIN still works correctly.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] `GET /api/v1/agents/:agentId/provider-config` returns `{ success: true, data: { provider_type, api_key, base_url, model, max_tokens } }` (flat, no double-wrap)
2. [ ] Java agent `AgentApp.createAiProvider()` can parse the provider config and use it (no fallback to env vars when backend has config)
3. [ ] `GET /api/v1/agents-status` returns all agents in the database, including those without heartbeat rows
4. [ ] Agents without heartbeats show `status: "offline"` in the heartbeat tab
5. [ ] All 1323+ backend tests pass
6. [ ] No lint errors
7. [ ] Regression test for double-wrapping bug (reproduces original failure)
8. [ ] Regression test for agents-visible-in-heartbeat (reproduces original failure)

---

## Out of Scope

- Java agent build and deployment (agent fix is defensive parsing in existing code)
- New agent registration mechanism (agents are still created via UI)
- Real-time agent connection push notifications (agents still need to send first heartbeat)
- Provider screen UI changes (providers screen works; the issue was agent consumption)
- WebSocket or polling improvements for agent status

---

## Performance Considerations

- `getAllAgents()` query change: `FROM agents LEFT JOIN agent_heartbeats` is slightly more expensive than `FROM agent_heartbeats` but still O(1) per agent. The agents table is small (< 100 rows typically).
- No caching needed for these changes.
- No N+1 query risk.

---

## Security Considerations

- No auth changes — all endpoints use existing auth middleware.
- No new sensitive data exposed.
- The `getAllAgents()` change exposes agent names and status to anyone with `AGENT_READ` permission (same as before — agents with heartbeats were already visible).

---

## Testing Checklist

### Backend Tests
- [ ] `backend/src/__tests__/agentEdit.test.js` — extend for flat `getProviderConfig()` response
- [ ] `backend/src/__tests__/heartbeatService.test.js` — extend `getAllAgents()` test for agents without heartbeats
- [ ] New regression test file: `backend/src/__tests__/agentProviderConfig.test.js` — tests double-wrapping fix
- [ ] Every new/changed service method has test cases
- [ ] Every changed route handler has test cases
- [ ] Happy path AND error paths tested
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Frontend Tests
- [ ] No frontend changes needed — API clients already handle `{ success, data }` format via `extractData()`
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify provider config response shape if tested

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes (no changes needed)

---

## Anti-Patterns to Avoid

- ❌ **Adding a new API endpoint** — fix the existing one
- ❌ **Adding DB migrations** — no schema changes needed
- ❌ **Creating new test files for existing functionality** — extend existing tests
- ❌ **Changing the Java agent build process** — only fix response parsing
- ❌ **Skipping the regression test** — every bug fix must have a regression test

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
