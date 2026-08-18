# 03_ARCHITECT_IMPLEMENTATION.md — Agent Connectivity Fixes

**Use this template for every ticket.**

---

## Ticket: bp-120-agent-connectivity-fixes — Fix Agent Provider Config, Visibility, and Response Format

**Status**: planned
**Priority**: P0
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2025-08-18
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend + Java Agent
**Dependencies**: None

---

### a) Purpose

Three bugs prevent Java agents from functioning:
1. Double-wrapped provider config response → agents can't parse AI provider settings
2. Agents invisible in heartbeat tab → users can't see agents that haven't connected yet
3. Inconsistent response format across provider endpoints

Fixing these enables agents to connect, fetch their config, and appear in the UI.

---

### b) Actions

#### Implementation Order

1. **[Fix #1] Remove double-wrapping in getProviderConfig** — `backend/src/services/AgentService.js`
   - Remove `{ success, data }` wrapper from service return
   - *Depends on*: nothing

2. **[Fix #2] Show all agents in heartbeat tab** — `backend/src/services/HeartbeatService.js`
   - Change `getAllAgents()` FROM table from `agent_heartbeats` to `agents`
   - *Depends on*: nothing

3. **[Fix #3] Defensive Java agent parsing** — `agent/src/main/java/.../AgentApp.java`
   - Add double-wrap detection in `createAiProvider()`
   - *Depends on*: nothing (can be done in parallel with backend fixes)

4. **[Tests] Update existing tests + create regression test** — `backend/src/__tests__/`
   - Update `agentEdit.test.js` for flat response
   - Update `heartbeatService.test.js` for agents-without-heartbeats
   - Create `agentProviderConfig.test.js` regression test
   - *Depends on*: Steps 1-2

5. **[Verification] Run all tests + lint**
   - `npm test` → all pass
   - `npm run lint` → no errors
   - *Depends on*: Step 4

---

### Phase 1: Backend Fixes

#### Step 1: Fix `AgentService.getProviderConfig()` — `backend/src/services/AgentService.js`

**Current code** (line 159):
```js
return { success: true, data: {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
}};
```

**Change to**:
```js
return {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
};
```

The route handler at `agents.js:334` already wraps with `{ success, data }`:
```js
res.json({ success: true, data: config });
```
So the final response will be `{ success: true, data: { provider_type, ... } }` — correct.

#### Step 2: Fix `HeartbeatService.getAllAgents()` — `backend/src/services/HeartbeatService.js`

**Current code** (lines 47-65):
```js
const result = await pool.query(
  `SELECT
    ah.agent_id, a.name, ah.status, ah.current_ticket_id,
    t.title as current_ticket_title, ah.last_seen, ah.current_step,
    COALESCE(COUNT(aa.id), 0) as actions_today,
    COALESCE(SUM(aa.cost_incurred), 0) as cost_today
  FROM agent_heartbeats ah
  LEFT JOIN agents a ON a.id = ah.agent_id
  LEFT JOIN tickets t ON t.id = ah.current_ticket_id
  LEFT JOIN agent_actions aa ON aa.agent_id = ah.agent_id AND aa.created_at >= CURRENT_DATE
  GROUP BY ah.agent_id, a.name, ah.status, ah.current_ticket_id, t.title, ah.last_seen, ah.current_step
  ORDER BY ah.last_seen DESC NULLS LAST`
);
```

**Change to**:
```js
const result = await pool.query(
  `SELECT
    a.id as agent_id, a.name,
    COALESCE(ah.status, 'offline') as status,
    ah.current_ticket_id,
    t.title as current_ticket_title,
    ah.last_seen, ah.current_step,
    COALESCE(COUNT(aa.id), 0) as actions_today,
    COALESCE(SUM(aa.cost_incurred), 0) as cost_today
  FROM agents a
  LEFT JOIN agent_heartbeats ah ON ah.agent_id = a.id
  LEFT JOIN tickets t ON t.id = ah.current_ticket_id
  LEFT JOIN agent_actions aa ON aa.agent_id = a.id AND aa.created_at >= CURRENT_DATE
  GROUP BY a.id, a.name, ah.status, ah.current_ticket_id, t.title, ah.last_seen, ah.current_step
  ORDER BY ah.last_seen DESC NULLS LAST`
);
```

Key changes:
- `FROM agents a LEFT JOIN agent_heartbeats ah` (swapped)
- `a.id as agent_id` (was `ah.agent_id`)
- `COALESCE(ah.status, 'offline')` (was just `ah.status`)
- `aa.agent_id = a.id` in the agent_actions join (was `ah.agent_id`)
- `GROUP BY a.id, a.name` (was `ah.agent_id, a.name`)

#### Step 3: Defensive Java Agent Parsing — `agent/src/main/java/com/vibecode/agent/AgentApp.java`

**Current code** (lines 84-92):
```java
private AiProvider createAiProvider() {
    Map<String, Object> providerConfig = null;
    try {
        providerConfig = apiService.getProviderConfig(config.getAgentId());
        log.info("Fetched provider config from backend: type={}, model={}",
            providerConfig.get("provider_type"), providerConfig.get("model"));
    } catch (Exception e) {
        log.warn("Failed to fetch provider config from backend, falling back to env vars: {}", e.getMessage());
    }
```

**Change to**:
```java
private AiProvider createAiProvider() {
    Map<String, Object> providerConfig = null;
    try {
        Map<String, Object> rawConfig = apiService.getProviderConfig(config.getAgentId());
        // Defensive: handle double-wrapped responses from buggy backend versions
        if (rawConfig != null && rawConfig.containsKey("success") && rawConfig.containsKey("data")
            && rawConfig.get("data") instanceof Map) {
            Map<String, Object> inner = (Map<String, Object>) rawConfig.get("data");
            if (inner.containsKey("provider_type")) {
                // Already flat — good
                providerConfig = inner;
            } else if (inner.containsKey("success") && inner.containsKey("data")
                && inner.get("data") instanceof Map) {
                // Double-wrapped — unwrap once
                providerConfig = (Map<String, Object>) inner.get("data");
            } else {
                providerConfig = inner;
            }
        } else {
            providerConfig = rawConfig;
        }
        log.info("Fetched provider config from backend: type={}, model={}",
            providerConfig != null ? providerConfig.get("provider_type") : "null",
            providerConfig != null ? providerConfig.get("model") : "null");
    } catch (Exception e) {
        log.warn("Failed to fetch provider config from backend, falling back to env vars: {}", e.getMessage());
    }
```

---

### Phase 2: Tests

#### Update `backend/src/__tests__/agentEdit.test.js`

**Change** in `getProviderConfig` service-level tests (lines 136-178):
- Mock `pool.query` returns flat object (not `{ success, data: {...} }`)
- Assert result has `provider_type` directly (not `result.data.data.provider_type`)

#### Update `backend/src/__tests__/heartbeatService.test.js`

**Change** in `getAllAgents()` tests:
- Add test: "returns agents without heartbeat rows with status 'offline'"
- Mock: agents table has rows, agent_heartbeats table is empty
- Assert: agents appear with `status: "offline"`

#### Create `backend/src/__tests__/agentProviderConfig.test.js`

New regression test file:
```js
describe('Agent Provider Config — Regression Test for Double-Wrapping Fix', () => {
  it('getProviderConfig returns flat object (not double-wrapped)', async () => {
    // Mock agent lookup
    pool.query.mockImplementation(() => {
      return Promise.resolve({ rows: [{ id: 'a1', api_key_hash: 'hash', provider_id: 'p1' }] });
    });
    // Mock provider lookup
    pool.query.mockImplementation(() => {
      return Promise.resolve({ rows: [{ provider_type: 'claude', api_key_encrypted: 'enc', base_url: null, model: 'claude-sonnet-4', max_tokens: 4096 }] });
    });
    jest.spyOn(require('../utils/crypto'), 'decrypt').mockReturnValue('decrypted-key');
    
    const result = await AgentService.getProviderConfig('a1', 'test-key');
    
    // CRITICAL: result must NOT have { success, data } wrapper
    expect(result).toHaveProperty('provider_type', 'claude');
    expect(result).toHaveProperty('api_key', 'decrypted-key');
    expect(result).not.toHaveProperty('success');
    expect(result).not.toHaveProperty('data');
  });
  
  it('route handler wraps service result as { success, data }', async () => {
    // Test that the route handler produces correct single-wrap format
    const AgentService = require('../services/AgentService');
    jest.spyOn(AgentService, 'getProviderConfig').mockResolvedValue({
      provider_type: 'claude',
      api_key: 'key',
      base_url: null,
      model: 'claude-sonnet-4',
      max_tokens: 4096,
    });
    
    const res = await request(app)
      .get('/api/v1/agents/a1/provider-config')
      .set('X-API-Key', 'test-key');
    
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        provider_type: 'claude',
        api_key: 'key',
        base_url: null,
        model: 'claude-sonnet-4',
        max_tokens: 4096,
      },
    });
  });
});
```

---

### c) Per-File Action Plan

#### `backend/src/services/AgentService.js` (MODIFY)
- **Change**: Remove `{ success, data }` wrapper from `getProviderConfig()` return (line 159)
- **Position**: Lines 159-165
- **Before**: `return { success: true, data: { provider_type, ... } };`
- **After**: `return { provider_type, api_key, base_url, model, max_tokens };`

#### `backend/src/services/HeartbeatService.js` (MODIFY)
- **Change**: Swap FROM table in `getAllAgents()` (lines 47-65)
- **Position**: Lines 47-65
- **Before**: `FROM agent_heartbeats ah LEFT JOIN agents a`
- **After**: `FROM agents a LEFT JOIN agent_heartbeats ah`

#### `agent/src/main/java/com/vibecode/agent/AgentApp.java` (MODIFY)
- **Change**: Add defensive double-wrap detection in `createAiProvider()` (lines 84-92)
- **Position**: Lines 86-92
- **Add**: unwrap logic before using `providerConfig`

#### `backend/src/__tests__/agentEdit.test.js` (MODIFY)
- **Change**: Update mock return values and assertions for flat response
- **Position**: Lines 136-178 (service-level `getProviderConfig` tests)

#### `backend/src/__tests__/heartbeatService.test.js` (MODIFY)
- **Change**: Add test for agents without heartbeats
- **Position**: After existing `getAllAgents()` tests

#### `backend/src/__tests__/agentProviderConfig.test.js` (CREATE)
- **New file**: Regression test for double-wrapping fix
- **Tests**: Flat response shape, route handler single-wrap, error cases

---

### d) Dependencies

- No new dependencies
- All changes are self-contained within existing modules

---

### e) Risks/Edge Cases

- **[Risk]**: Existing mocks in `agentEdit.test.js` return `{ success, data: {...} }`
  - **Mitigation**: Update all mocks to return flat object
- **[Risk]**: `getAllAgents()` aggregation changes may affect action counts
  - **Mitigation**: The LEFT JOIN from `agents` preserves aggregation semantics
- **[Risk]**: Java agent defensive parsing adds complexity
  - **Mitigation**: Simple null-check, no logic change for common case

---

### f) Testing

#### Test-First Requirement

If `04_SPECIFICATION.md` exists, create **empty test stub files** before production code.

#### Backend Unit Tests
- [ ] `agentEdit.test.js` — extend `getProviderConfig` tests for flat response
- [ ] `heartbeatService.test.js` — extend `getAllAgents()` for agents without heartbeats
- [ ] **NEW**: `agentProviderConfig.test.js` — regression test for double-wrapping
- [ ] Every new/changed service method has test cases
- [ ] Happy path AND error paths tested
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes (no frontend changes)

---

### g) Migration Notes

No migrations needed.

---

### h) Files Changed

**Backend:**
```
backend/src/services/AgentService.js          → MODIFY (remove wrapper from getProviderConfig)
backend/src/services/HeartbeatService.js      → MODIFY (swap FROM table in getAllAgents)
backend/src/__tests__/agentEdit.test.js       → MODIFY (update test expectations)
backend/src/__tests__/heartbeatService.test.js → MODIFY (add agents-without-heartbeats test)
backend/src/__tests__/agentProviderConfig.test.js → CREATE (regression test)
```

**Java Agent:**
```
agent/src/main/java/com/vibecode/agent/AgentApp.java → MODIFY (defensive parsing)
```

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns
- [ ] Backend uses parameterized queries
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] All tests written and passing
- [ ] No lint errors
- [ ] Coverage threshold enforced (60%)
- [ ] Regression tests added for both bugs

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Java agent: rebuild and verify provider config fetch works
5. [ ] Frontend: agents appear in heartbeat tab even without heartbeats
6. [ ] End-to-end: create agent → assign provider → start agent → agent connects → appears in heartbeat tab

---

*Fill in all sections before starting implementation.*
