# 02_ARCHITECT_DESIGN.md — Agent Connectivity Fixes

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Java Agent
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Java agents created via the UI cannot function because:
1. They cannot fetch their AI provider configuration from the backend (double-wrapped response)
2. They do not appear in the Heartbeat tab until they successfully connect (circular dependency — can't connect without provider config, can't see they need to connect because they're invisible)

---

## Current State

### Bug #1: Double-Wrapping in Provider Config

**`AgentService.getProviderConfig()`** (AgentService.js:159) returns:
```js
return { success: true, data: {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
}};
```

**Route handler** (agents.js:334) wraps it again:
```js
res.json({ success: true, data: config });
```

**Result**: Java agent receives `{ success: true, data: { success: true, data: { provider_type, ... } } }`.
Java `providerConfig.get("provider_type")` returns null → falls back to env vars.

### Bug #2: Agents Invisible Without Heartbeats

**`HeartbeatService.getAllAgents()`** (HeartbeatService.js:47-65) queries:
```sql
SELECT ah.agent_id, a.name, ah.status, ...
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
...
```

This starts from `agent_heartbeats` — agents without a heartbeat row are excluded. The LEFT JOIN only fills in agent name if the heartbeat exists.

**Contrast with `getAgentStatus()`** (line 24-43) which correctly does:
```sql
SELECT a.id as agent_id, a.name as agent_name, ...
FROM agents a
LEFT JOIN agent_heartbeats ah ON ah.agent_id = a.id
WHERE a.id = $1
```

### Bug #3: Response Format Inconsistency

All other provider endpoints return consistent `{ success, data }` format:
- `GET /providers` → `{ success: true, data: [...] }`
- `GET /providers/:id` → `{ success: true, data: {...} }`
- `POST /providers` → `{ success: true, data: {...} }`

Only `GET /agents/:agentId/provider-config` has double-wrapping.

---

## Design

### Fix #1: Remove Double-Wrapping in Provider Config

**Strategy**: Change `AgentService.getProviderConfig()` to return the flat config object directly. Remove the `{ success, data }` wrapper from the service method. The route handler already provides the outer wrapper.

**Before**:
```js
// Service returns: { success: true, data: { provider_type, ... } }
// Route handler wraps: { success: true, data: { success: true, data: { ... } } }
```

**After**:
```js
// Service returns: { provider_type, api_key, base_url, model, max_tokens }
// Route handler wraps: { success: true, data: { provider_type, ... } }
```

**Files changed**:
- `backend/src/services/AgentService.js` — remove `success`/`data` wrapper from return value (line 159)
- `backend/src/api/agents.js` — no change needed (route handler already wraps correctly)

### Fix #2: Show All Agents in Heartbeat Tab

**Strategy**: Change `getAllAgents()` to query FROM `agents` LEFT JOIN `agent_heartbeats` (same pattern as `getAgentStatus()`).

**Before**:
```sql
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
```

**After**:
```sql
FROM agents a
LEFT JOIN agent_heartbeats ah ON ah.agent_id = a.id
```

This ensures all agents appear, with `ah.status = NULL` (rendered as `"offline"` via COALESCE in the frontend).

**Files changed**:
- `backend/src/services/HeartbeatService.js` — swap FROM table in `getAllAgents()`

### Fix #3: Defensive Java Agent Parsing

**Strategy**: Add defensive parsing in `AgentApp.createAiProvider()` to handle both the old (double-wrapped) and new (flat) response formats. This ensures the Java agent works during the transition window if some instances haven't been updated yet.

**Implementation**: After deserializing the response, check if `data` contains another `data` field (double-wrapped). If so, unwrap it once.

**Files changed**:
- `agent/src/main/java/com/vibecode/agent/AgentApp.java` — add unwrap logic in `createAiProvider()`

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/AgentService.js` | MODIFY | Remove `{ success, data }` wrapper from `getProviderConfig()` return (line 159) |
| `backend/src/services/HeartbeatService.js` | MODIFY | Change `getAllAgents()` FROM table from `agent_heartbeats` to `agents` (line 47) |
| `agent/src/main/java/.../AgentApp.java` | MODIFY | Add defensive double-wrap detection in `createAiProvider()` (line 87) |
| `backend/src/__tests__/agentEdit.test.js` | MODIFY | Update `getProviderConfig` test expectations (flat response) |
| `backend/src/__tests__/heartbeatService.test.js` | MODIFY | Update `getAllAgents()` test for agents without heartbeats |
| `backend/src/__tests__/agentProviderConfig.test.js` | CREATE | New regression test for double-wrapping fix |

---

## Data Flow Diagram

### Provider Config Flow (After Fix)
```
[Java Agent] → GET /agents/{id}/provider-config (X-API-Key)
    → [Route: agents.js:327] verify API key, call service
    → [Service: AgentService.getProviderConfig] find agent by key, lookup provider, decrypt key
    → Returns: { provider_type, api_key, base_url, model, max_tokens }
    → [Route] wraps: { success: true, data: { ... } }
    → [Java Agent] parses → uses config
```

### Agent Visibility Flow (After Fix)
```
[Frontend] → GET /agents-status
    → [Service: HeartbeatService.getAllAgents] FROM agents LEFT JOIN agent_heartbeats
    → Returns: all agents, including those without heartbeats (status = "offline")
    → [Frontend] renders in heartbeat tab
```

---

## Dependencies

### Backend Dependencies
- `AgentService.getAgentByApiKey()` — unchanged, still used by `getProviderConfig()`
- `HeartbeatService.recordHeartbeat()` — unchanged
- No new DB migrations needed

### Java Agent Dependencies
- `ApiService.getProviderConfig()` — unchanged, same endpoint
- `AgentApp.createAiProvider()` — defensive parsing added
- No Java dependency changes

---

## Config / Environment Changes

- No new environment variables
- No config file changes

---

## Database Changes

- No schema changes
- No migrations needed

---

## Security Considerations

- No auth changes
- No new sensitive data exposed
- `getAllAgents()` change: agents without heartbeats now show `status: "offline"` — this was already the case for agents with heartbeats that went stale. No security impact.

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/agentEdit.test.js` | `getProviderConfig()` response shape |
| Backend unit | Jest | `backend/src/__tests__/heartbeatService.test.js` | `getAllAgents()` returns agents without heartbeats |
| **New regression** | Jest | `backend/src/__tests__/agentProviderConfig.test.js` | Double-wrapping fix verified |

### Backend Unit Tests

#### `agentEdit.test.js` — extend `getProviderConfig` tests
- [x] `getProviderConfig()` returns flat `{ provider_type, api_key, base_url, model, max_tokens }`
- [x] Route handler wraps it as `{ success: true, data: { ... } }`
- [x] `AGENT_NOT_FOUND` → 404
- [x] `NO_PROVIDER` → 404

#### `heartbeatService.test.js` — extend `getAllAgents()` tests
- [x] `getAllAgents()` returns agents even without heartbeat rows
- [x] Agents without heartbeats have `status: "offline"`
- [x] Agents with heartbeats still return correctly
- [x] Action count aggregation still works

#### New: `agentProviderConfig.test.js` — regression test
- [x] Double-wrapped response would cause `provider_type` to be null
- [x] Flat response correctly returns all fields
- [x] Route handler produces correct single-wrap format

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: Existing test mocks return `{ success, data: {...} }` from `getProviderConfig()`
  - **Mitigation**: Update all mocks in `agentEdit.test.js` to return flat object
- **[Risk]**: `getAllAgents()` aggregation (`COUNT(aa.id)`, `SUM(aa.cost_incurred)`) may behave differently with reversed JOIN
  - **Mitigation**: The LEFT JOIN from `agents` to `agent_heartbeats` to `agent_actions` preserves the same aggregation semantics. Agents without heartbeats get `COUNT = 0`, `SUM = 0`.

### Java Agent Risks
- **[Risk]**: Defensive parsing adds complexity
  - **Mitigation**: Simple null-check — if `data.data` exists, use `data.data`, else use `data`. No logic change for the common case.

### Edge Cases
- **Agent created but never started**: Now shows as "offline" in heartbeat tab (was invisible before)
- **Agent started but provider not configured**: `getProviderConfig()` throws `NO_PROVIDER` → 404 (same as before, agent falls back to env vars)
- **Provider deleted after agent created**: `getProviderConfig()` throws `PROVIDER_NOT_FOUND` → 404 (same as before)
- **Multiple agents with same provider**: Each agent gets its own provider config (no change)

---

## Alternative Designs Considered

### Alternative 1: Add New Endpoint for Agent Status List
- **Description**: Create a separate `GET /agents` endpoint that returns all agents (not just those with heartbeats)
- **Pros**: Clean separation of concerns
- **Cons**: Unnecessary new endpoint. `getAllAgents()` can be fixed with a one-line SQL change.
- **Decision**: Fix existing endpoint instead of creating new one.

### Alternative 2: Backend Push Notification on Agent Registration
- **Description**: When agent first authenticates via API key, server marks it as "registered" and pushes to frontend via WebSocket
- **Pros**: Real-time visibility
- **Cons**: Requires WebSocket infrastructure. Overkill for this issue. Agents can poll the agents-status endpoint.
- **Decision**: Simple query fix is sufficient. Agents appear after first heartbeat (which now works because provider config is fixed).

### Alternative 3: Java Agent Polling for Provider Config
- **Description**: Instead of startup fetch, have agent poll for config changes periodically
- **Pros**: Hot-reload of provider config
- **Cons**: Already exists as `GET /agents/:id/provider-config/changed`. Not related to the double-wrapping bug.
- **Decision**: Fix the double-wrapping bug first. Config polling is a separate enhancement.

---

## Pending Scope Items to Present to User

**No deferred improvements found in previous tickets relevant to this ticket.**

---

## Specification Generation

- [x] `03_ARCHITECT_IMPLEMENTATION.md` created with exact file operations
- [x] `04_SPECIFICATION.md` created with test expectations

---

*This design document guides implementation. The three fixes are independent and can be implemented in any order.*
