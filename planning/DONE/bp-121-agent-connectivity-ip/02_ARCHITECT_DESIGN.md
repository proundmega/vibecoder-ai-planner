# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Java agents deployed on non-localhost hosts fail to function due to three backend bugs. The root causes are: (1) CORS strict allowlist rejects non-localhost origins, (2) provider config response is double-wrapped making it unparseable by the Java agent, and (3) agent listing SQL queries FROM the wrong table so agents without heartbeats are invisible. All three were identified in bp-120 (marked "Planned" but never implemented).

---

## Current State

### Existing Backend

**CORS middleware** (`backend/src/middleware/cors.js`):
- Strict exact-string origin matching against `ALLOWED_ORIGINS` env var
- Returns 403 `{ CORS_ERROR: 'Origin not allowed' }` for non-matching origins
- No wildcard, no regex, no prefix matching

**CORS configuration**:
- `docker-compose.yml:59` (production): `${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002}`
- `docker-compose.override.yml:7` (dev): `http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002`
- `backend/.env.example:24`: `http://localhost:3000,http://localhost:3002,https://app.vibecode.ai`

**Provider config flow** (`backend/src/api/agents.js:327-347` + `AgentService.getProviderConfig()` at line 147-166):
1. Route reads `X-API-Key` header (no auth middleware)
2. Calls `AgentService.getProviderConfig(agentId, apiKey)`
3. Service returns `{ success: true, data: { provider_type, api_key, base_url, model, max_tokens } }`
4. Route wraps again: `res.json({ success: true, data: config })`
5. **Result**: `{ success: true, data: { success: true, data: { provider_type, ... } } }` — double-wrapped

**Agent listing** (`backend/src/services/HeartbeatService.getAllAgents()` at line 46-66):
```sql
SELECT ah.agent_id, a.name, ah.status, ...
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
LEFT JOIN tickets t ON t.id = ah.current_ticket_id
LEFT JOIN agent_actions aa ON aa.agent_id = ah.agent_id AND aa.created_at >= CURRENT_DATE
GROUP BY ah.agent_id, a.name, ...
ORDER BY ah.last_seen DESC NULLS LAST
```
- Queries FROM `agent_heartbeats` — agents without heartbeats produce zero rows
- Should be FROM `agents` LEFT JOIN `agent_heartbeats` to show all agents

### Existing Frontend

- `frontend/src/views/AgentList.vue` — Two tabs: "Heartbeat" (calls `GET /api/v1/agents-status`) and "Agents" (calls `GET /api/v1/agents/`)
- `frontend/src/api/agents.ts` — API client with `fetchAgentStatusList()` and `listAgents()`
- Frontend uses relative URLs, so CORS is required for cross-origin requests

### Gap Analysis

| Bug | What exists | What's needed |
|-----|-------------|---------------|
| CORS | Strict allowlist works for localhost | Add `127.0.0.1` to production default |
| Provider config | Double-wrapped response (bug) | Remove wrapper from service return |
| Agent listing | FROM agent_heartbeats (bug) | Change to FROM agents LEFT JOIN heartbeats |

---

## Design

### Option A: Fix Backend Only (Recommended)

All three fixes are in backend code. No frontend changes needed.

**Fix 1: CORS — extend production default**

Modify `docker-compose.yml` line 59:
```yaml
# Before:
- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002}
# After:
- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002}
```

This is additive — existing deployments that set `ALLOWED_ORIGINS` explicitly are unaffected. The `127.0.0.1` origins are a common dev pattern (many developers use `127.0.0.1` instead of `localhost`).

**Fix 2: Provider config — remove double-wrap**

Modify `backend/src/services/AgentService.js` line 159:
```javascript
// Before:
return { success: true, data: {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
}};

// After:
return {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
};
```

The route handler at `agents.js:334` already wraps with `{ success, data }`:
```javascript
const config = await AgentService.getProviderConfig(req.params.agentId, apiKey);
res.json({ success: true, data: config });
```

So the final response will be: `{ success: true, data: { provider_type, api_key, base_url, model, max_tokens } }` — single-wrapped, correct.

**Fix 3: Agent listing — swap FROM/JOIN**

Modify `backend/src/services/HeartbeatService.js` line 47-63:
```sql
-- Before:
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
LEFT JOIN tickets t ON t.id = ah.current_ticket_id
LEFT JOIN agent_actions aa ON aa.agent_id = ah.agent_id AND aa.created_at >= CURRENT_DATE
GROUP BY ah.agent_id, a.name, ah.status, ah.current_ticket_id, t.title, ah.last_seen, ah.current_step

-- After:
FROM agents a
LEFT JOIN agent_heartbeats ah ON ah.agent_id = a.id
LEFT JOIN tickets t ON t.id = ah.current_ticket_id
LEFT JOIN agent_actions aa ON aa.agent_id = a.id AND aa.created_at >= CURRENT_DATE
GROUP BY a.id, a.name, ah.status, ah.current_ticket_id, t.title, ah.last_seen, ah.current_step
```

Key changes:
- `FROM agents a` instead of `FROM agent_heartbeats ah` — all agents appear
- `ah.agent_id = a.id` instead of `a.id = ah.agent_id` — same join condition, just flipped
- `aa.agent_id = a.id` instead of `aa.agent_id = ah.agent_id` — agent_actions join uses agents table (handles agents without heartbeats)
- `GROUP BY a.id, a.name` instead of `GROUP BY ah.agent_id, a.name` — group by agents table primary key

### Option B: Fix Backend + Defensive Java Agent Parsing

Fix the backend as above AND add defensive parsing in the Java agent to handle both wrapped and unwrapped responses during transition.

**Cons**: Requires Java agent changes, requires agent redeployment, adds complexity.
**Decision**: Not included in this ticket. Deferred to a future agent ticket as a transition safety net. The backend fix is the correct behavior; the Java agent should be updated to match.

### Option C: Add Wildcard CORS Support

Add regex/prefix matching to CORS middleware (e.g., `http://*.local` or `http://192.168.*.*`).

**Cons**: Weaker security, potential for origin spoofing, deviates from strict allowlist pattern.
**Decision**: Not recommended. Users should explicitly configure `ALLOWED_ORIGINS` for their deployment. Adding `127.0.0.1` to the default is a reasonable exception (it's a loopback address), but wildcard LAN IPs would be a security concern.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `docker-compose.yml` | MODIFY | Line 59: Add `http://127.0.0.1:3000,http://127.0.0.1:3002` to ALLOWED_ORIGINS default |
| `backend/src/services/AgentService.js` | MODIFY | Line 159: Remove `{ success, data }` wrapper from `getProviderConfig()` return |
| `backend/src/services/HeartbeatService.js` | MODIFY | Lines 47-63: Swap FROM/JOIN order in `getAllAgents()` SQL |
| `backend/src/__tests__/agentProviderConfig.test.js` | CREATE | Regression test: provider config returns single-wrapped response |
| `backend/src/__tests__/agentListing.test.js` | CREATE | Regression test: agents without heartbeats appear in listing |
| `backend/src/__tests__/corsValidation.test.js` | EXTEND | Add tests for `127.0.0.1` origins |

---

## Data Flow Diagram

### Provider Config Flow (after fix)
```
[Java Agent] → GET /api/v1/agents/:agentId/provider-config (X-API-Key header)
    → [Route: agents.js:327] reads X-API-Key, calls service
    → [Service: AgentService.getProviderConfig] queries providers table, decrypts key
    → Returns { provider_type, api_key, base_url, model, max_tokens }  ← NO wrapper
    → [Route] wraps: res.json({ success: true, data: config })
    → Response: { success: true, data: { provider_type, api_key, base_url, model, max_tokens } }
    → [Java Agent] parses response.getData() → { provider_type, api_key, base_url, model, max_tokens } ✓
```

### Agent Listing Flow (after fix)
```
[Frontend AgentList.vue] → GET /api/v1/agents-status (JWT auth)
    → [Route: agentHeartbeat.js:78] verifyToken, calls HeartbeatService.getAllAgents()
    → [Service] queries: FROM agents a LEFT JOIN agent_heartbeats ah  ← SWAPPED
    → Returns ALL agents (with or without heartbeats)
    → Response: { success: true, data: [ { agent_id, name, status, ... }, ... ] }
    → [Frontend] renders all agents in heartbeat tab ✓
```

---

## Dependencies

### Backend Dependencies
- `backend/src/db.js` — pg Pool (used by both services)
- `backend/src/utils/crypto.js` — decrypt function (used by AgentService)
- `backend/src/middleware/cors.js` — CORS middleware (used in index.js)
- No new dependencies needed

### Frontend Dependencies
- None — no frontend changes

### Cross-Cutting Dependencies
- None — no OpenAPI spec changes, no generated types regeneration needed

---

## Config / Environment Changes

- [x] New environment variables: NONE — using existing `ALLOWED_ORIGINS`
- [x] New database migrations: NONE — no schema changes
- [x] New npm dependencies: NONE
- [x] Existing config changes: `docker-compose.yml` line 59 — extends ALLOWED_ORIGINS default

---

## Database Changes

### New Tables
None.

### New Columns
None.

### Indexes
None.

### Migrations
None.

---

## Security Considerations

- CORS origin allowlist remains strict (exact string match, no wildcards)
- Adding `127.0.0.1` to production default is safe (loopback address, not accessible from network)
- Provider config still requires valid X-API-Key (unchanged auth)
- Agent listing still requires JWT auth (unchanged auth)
- No sensitive data exposure changes

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/agentProviderConfig.test.js` | Provider config single-wrap response, error cases |
| Backend unit | Jest | `backend/src/__tests__/agentListing.test.js` | Agent listing shows all agents, ordering |
| Backend unit (extended) | Jest | `backend/src/__tests__/corsValidation.test.js` | 127.0.0.1 origins allowed |
| Backend integration | Jest + real PG | Existing integration tests | Full HTTP→DB lifecycle |
| **Bash integration** | curl + helpers | `backend/integration-test/suites/` | Provider config and agent listing via curl |

### Backend Unit Tests — Agent Provider Config

```
✓ [happy] getProviderConfig returns single-wrapped response with provider fields
✓ [happy] getProviderConfig decrypts API key correctly
✓ [error] getProviderConfig throws AGENT_NOT_FOUND for invalid agent
✓ [error] getProviderConfig throws NO_PROVIDER when agent has no provider_id
✓ [error] getProviderConfig throws PROVIDER_NOT_FOUND when provider doesn't exist
✓ [route] GET /agents/:agentId/provider-config returns { success, data: {...} } single-wrapped
✓ [route] GET /agents/:agentId/provider-config without X-API-Key returns 401
```

### Backend Unit Tests — Agent Listing

```
✓ [happy] getAllAgents returns agents with heartbeats
✓ [happy] getAllAgents returns agents WITHOUT heartbeats (the bug fix)
✓ [happy] getAllAgents returns empty array when no agents exist
✓ [happy] getAllAgents orders by last_seen DESC
✓ [edge] agent with heartbeat but no current ticket shows null ticket fields
✓ [edge] agent with no heartbeat shows null heartbeat fields but still appears
```

### Bash Integration Suite

```
✓ [happy] GET /api/v1/agents/:agentId/provider-config returns 200 with single-wrapped data
✓ [happy] GET /api/v1/agents-status returns all agents including those without heartbeats
✓ [auth] GET /api/v1/agents/:agentId/provider-config without X-API-Key returns 401
```

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: Java agent may expect double-wrapped response. **Mitigation**: Fix backend to correct behavior. Add defensive parsing in future agent ticket.
- **[Risk]**: Changing `GROUP BY` columns in `getAllAgents()` may affect existing tests. **Mitigation**: Update affected tests.

### Frontend Risks
- None — no frontend changes.

### Integration Risks
- **[Risk]**: Existing tests for `getAllAgents()` may assume agents-only-from-heartbeats behavior. **Mitigation**: Update tests to verify the new (correct) behavior.
- **[Risk]**: Existing tests for `getProviderConfig()` may expect double-wrapped response. **Mitigation**: Update tests to expect single-wrapped response.

### Edge Cases
- **Agent with heartbeat but deleted from agents table**: LEFT JOIN handles this — agent appears with null heartbeat fields (existing behavior, unchanged)
- **Agent with no heartbeat**: Now appears with null heartbeat fields (the fix)
- **Empty origin header**: CORS middleware calls `next()` (existing behavior, unchanged)
- **127.0.0.1 vs localhost**: Both are now allowed (they resolve to the same interface but are different origin strings)

---

## Alternative Designs Considered

### Alternative 1: Add Origin Prefix Matching to CORS

Allow `http://192.168.*.*` and `http://10.*.*.*` patterns in CORS.

- **Pros**: Works for any LAN IP without per-instance config
- **Cons**: Weaker security, potential for origin spoofing, deviates from strict allowlist
- **Decision**: Not chosen. LAN IPs are deployment-specific and should be configured per-instance.

### Alternative 2: Auto-Detect Origin in CORS

Echo back the `Origin` header if it matches the request host.

- **Pros**: Automatic, no config needed
- **Cons**: Security risk (any origin that matches the host pattern would be allowed), complex to implement correctly
- **Decision**: Not chosen. Strict allowlist is the correct security model.

### Alternative 3: Fix Java Agent Instead of Backend

Keep the double-wrapped response and fix the Java agent to parse it correctly.

- **Pros**: Less breaking (backend behavior unchanged)
- **Cons**: The double-wrap is a bug — the service shouldn't wrap, the route should. Fixing the agent perpetuates bad design.
- **Decision**: Not chosen. The backend fix is the correct approach. Java agent defensive parsing will be added later as a transition safety net.

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-120 | Defensive Java agent parsing for double-wrapped responses during transition | Java Agent | Future agent ticket | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user
