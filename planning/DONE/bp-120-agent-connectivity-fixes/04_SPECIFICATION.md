# 04_SPECIFICATION.md — Model Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-08-18

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed below
2. Create **production code files** (implementation)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code.

---

## File Operations

### CREATE: `backend/src/__tests__/agentProviderConfig.test.js`

**Imports**:
```js
const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');
const { pool } = require('../db');
```

**Mock setup** (at top, before describe blocks):
```js
jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((val) => 'decrypted-' + val),
  encrypt: jest.fn(),
  maskToken: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$mockhash123456789012345678901234567890'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: 'user-1', email: 'user@test.com', role: 'member' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));
```

**Test cases** (inside `describe` block):

```js
describe('Agent Provider Config — Double-Wrapping Regression Fix', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe('Service: AgentService.getProviderConfig()', () => {
    it('returns a flat object WITHOUT { success, data } wrapper', async () => {
      // Mock: agent lookup returns agent with provider_id
      pool.query.mockImplementation((sql) => {
        if (sql.includes('api_key_hash_prefix')) {
          return Promise.resolve({ rows: [{ id: 'a1', api_key_hash: 'hash', provider_id: 'p1' }] });
        }
        return Promise.resolve({ rows: [{ provider_type: 'claude', api_key_encrypted: 'enc', base_url: null, model: 'claude-sonnet-4', max_tokens: 4096 }] });
      });

      const result = await AgentService.getProviderConfig('a1', 'test-key');

      // CRITICAL: result must be flat, NOT double-wrapped
      expect(result).toHaveProperty('provider_type', 'claude');
      expect(result).toHaveProperty('api_key');
      expect(result).toHaveProperty('model', 'claude-sonnet-4');
      expect(result).toHaveProperty('max_tokens', 4096);
      // These must NOT exist — this is the regression check
      expect(result).not.toHaveProperty('success');
      expect(result).not.toHaveProperty('data');
    });

    it('throws AGENT_NOT_FOUND when no agent matches API key', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await expect(AgentService.getProviderConfig('a1', 'wrong-key'))
        .rejects.toThrow('AGENT_NOT_FOUND');
    });

    it('throws NO_PROVIDER when agent has no provider_id', async () => {
      pool.query.mockImplementation((sql) => {
        if (sql.includes('api_key_hash_prefix')) {
          return Promise.resolve({ rows: [{ id: 'a1', api_key_hash: 'hash', provider_id: null }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(AgentService.getProviderConfig('a1', 'test-key'))
        .rejects.toThrow('NO_PROVIDER');
    });

    it('throws PROVIDER_NOT_FOUND when provider does not exist', async () => {
      pool.query.mockImplementation((sql) => {
        if (sql.includes('api_key_hash_prefix')) {
          return Promise.resolve({ rows: [{ id: 'a1', api_key_hash: 'hash', provider_id: 'p999' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(AgentService.getProviderConfig('a1', 'test-key'))
        .rejects.toThrow('PROVIDER_NOT_FOUND');
    });
  });

  describe('Route: GET /api/v1/agents/:agentId/provider-config', () => {
    it('returns single-wrap { success, data } format with flat config', async () => {
      const mockConfig = {
        provider_type: 'claude',
        api_key: 'decrypted-key',
        base_url: null,
        model: 'claude-sonnet-4',
        max_tokens: 4096,
      };
      jest.spyOn(AgentService, 'getProviderConfig').mockResolvedValue(mockConfig);

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'test-key');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: mockConfig,
      });
      // Verify no double-wrapping
      expect(res.body.data).not.toHaveProperty('success');
      expect(res.body.data).not.toHaveProperty('data');
    });

    it('returns 401 when X-API-Key header is missing', async () => {
      const res = await request(app).get('/api/v1/agents/a1/provider-config');
      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 404 when agent not found', async () => {
      jest.spyOn(AgentService, 'getProviderConfig').mockRejectedValue(new Error('AGENT_NOT_FOUND'));

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'wrong-key');

      expect(res.statusCode).toBe(404);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error.code).toBe('AGENT_NOT_FOUND');
    });
  });
});
```

---

### MODIFY: `backend/src/services/AgentService.js`

**Change**: Remove `{ success, data }` wrapper from `getProviderConfig()` return value.

**Position**: Lines 159-165

**Before**:
```js
    return { success: true, data: {
      provider_type: provider.provider_type,
      api_key: decryptedKey,
      base_url: provider.base_url,
      model: provider.model,
      max_tokens: provider.max_tokens,
    }};
```

**After**:
```js
    return {
      provider_type: provider.provider_type,
      api_key: decryptedKey,
      base_url: provider.base_url,
      model: provider.model,
      max_tokens: provider.max_tokens,
    };
```

---

### MODIFY: `backend/src/services/HeartbeatService.js`

**Change**: Swap FROM table in `getAllAgents()` from `agent_heartbeats` to `agents`.

**Position**: Lines 47-65

**Before**:
```sql
SELECT
  ah.agent_id, a.name, ah.status, ah.current_ticket_id,
  t.title as current_ticket_title, ah.last_seen, ah.current_step,
  COALESCE(COUNT(aa.id), 0) as actions_today,
  COALESCE(SUM(aa.cost_incurred), 0) as cost_today
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
LEFT JOIN tickets t ON t.id = ah.current_ticket_id
LEFT JOIN agent_actions aa ON aa.agent_id = ah.agent_id AND aa.created_at >= CURRENT_DATE
GROUP BY ah.agent_id, a.name, ah.status, ah.current_ticket_id, t.title, ah.last_seen, ah.current_step
ORDER BY ah.last_seen DESC NULLS LAST
```

**After**:
```sql
SELECT
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
ORDER BY ah.last_seen DESC NULLS LAST
```

Key changes:
1. `FROM agent_heartbeats ah LEFT JOIN agents a` → `FROM agents a LEFT JOIN agent_heartbeats ah`
2. `ah.agent_id` → `a.id as agent_id`
3. `ah.status` → `COALESCE(ah.status, 'offline') as status`
4. `aa.agent_id = ah.agent_id` → `aa.agent_id = a.id`
5. `GROUP BY ah.agent_id, a.name` → `GROUP BY a.id, a.name`

---

### MODIFY: `agent/src/main/java/com/vibecode/agent/AgentApp.java`

**Change**: Add defensive double-wrap detection in `createAiProvider()`.

**Position**: Lines 86-92 (inside the try block)

**Before**:
```java
        providerConfig = apiService.getProviderConfig(config.getAgentId());
        log.info("Fetched provider config from backend: type={}, model={}",
            providerConfig.get("provider_type"), providerConfig.get("model"));
```

**After**:
```java
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
```

---

### MODIFY: `backend/src/__tests__/agentEdit.test.js`

**Change**: Update mock return values in service-level `getProviderConfig` tests.

**Position**: Lines 136-178

**Change in `getProviderConfig` describe block** (around line 140-148):

The mock should return a flat object, not `{ success, data: {...} }`:

```js
    it('returns decrypted provider config when agent has provider', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: 'prov-1' }
      const mockProvider = { provider_type: 'claude', api_key_encrypted: 'encrypted-key', base_url: null, model: 'claude-sonnet-4-20250514', max_tokens: 4096 }

      let queryCount = 0
      pool.query.mockImplementation(() => {
        queryCount++
        if (queryCount === 1) {
          return Promise.resolve({ rows: [mockAgent] })
        }
        return Promise.resolve({ rows: [mockProvider] })
      })

      const result = await AgentService.getProviderConfig('a1', 'test-key')

      // UPDATED: result is flat, not { success, data: {...} }
      expect(result).toHaveProperty('provider_type', 'claude')
      expect(result).toHaveProperty('model', 'claude-sonnet-4-20250514')
      expect(result).not.toHaveProperty('success')
      expect(result).not.toHaveProperty('data')
    })
```

Also update the route-level test mock (line 45):

**Before**:
```js
getProviderConfigSpy = jest.spyOn(AgentService, 'getProviderConfig').mockResolvedValue({ success: true, data: { provider_type: 'claude', api_key: 'decrypted-key', base_url: null, model: 'claude-sonnet-4-20250514', max_tokens: 4096 } })
```

**After**:
```js
getProviderConfigSpy = jest.spyOn(AgentService, 'getProviderConfig').mockResolvedValue({ provider_type: 'claude', api_key: 'decrypted-key', base_url: null, model: 'claude-sonnet-4-20250514', max_tokens: 4096 })
```

---

### MODIFY: `backend/src/__tests__/heartbeatService.test.js`

**Change**: Add test for agents without heartbeat rows.

**Position**: After existing `getAllAgents()` tests (around line 350)

**Add new test**:
```js
    it('should return agents even without heartbeat rows', async () => {
      // Mock: agents table has rows, agent_heartbeats is empty
      pool.query.mockImplementation((sql) => {
        if (sql.includes('agents') && sql.includes('agent_heartbeats')) {
          // getAllAgents query
          return Promise.resolve({
            rows: [
              {
                agent_id: 1,
                name: 'Agent Without Heartbeat',
                status: 'offline',
                current_ticket_id: null,
                current_ticket_title: null,
                last_seen: null,
                current_step: null,
                actions_today: 0,
                cost_today: 0,
              },
            ],
          })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await heartbeatService.getAllAgents()

      expect(result.length).toBe(1)
      expect(result[0].agent_id).toBe(1)
      expect(result[0].status).toBe('offline')
      expect(result[0].actions_today).toBe(0)
    })
```

---

## Test Expectations

### Backend Unit Tests

```
✓ [happy] getProviderConfig() returns flat { provider_type, api_key, base_url, model, max_tokens }
✓ [error] getProviderConfig() throws AGENT_NOT_FOUND when key doesn't match
✓ [error] getProviderConfig() throws NO_PROVIDER when agent has no provider_id
✓ [error] getProviderConfig() throws PROVIDER_NOT_FOUND when provider deleted
✓ [happy] route handler wraps service result as { success, data: {...} }
✓ [error] route handler returns 401 when X-API-Key missing
✓ [error] route handler returns 404 when agent not found
✓ [happy] getAllAgents() returns agents without heartbeat rows with status 'offline'
```

### Backend Bash Integration Tests

Not required — no new endpoints, only existing endpoint behavior changes.

### Frontend Tests

No frontend changes needed. The `extractData()` function in `client.ts` already handles `{ success, data }` format.

---

## Edge Cases to Handle

1. **Agent with provider deleted**: `getProviderConfig()` → `PROVIDER_NOT_FOUND` → 404 (agent falls back to env vars)
2. **Agent with no provider**: `getProviderConfig()` → `NO_PROVIDER` → 404 (agent falls back to env vars)
3. **Agent never sent heartbeat**: `getAllAgents()` → returns agent with `status: "offline"`
4. **Multiple agents, some with heartbeats, some without**: `getAllAgents()` → mixed results, ordered by `last_seen DESC NULLS LAST`
5. **Java agent with old backend version**: defensive parsing handles double-wrapped response
6. **Java agent with new backend version**: normal flat response, no unwrap needed

---

## Existing Code Patterns to Follow

- Use `jest.mock()` for dependencies (follow `agentEdit.test.js` pattern)
- Use `pool.query.mockImplementation()` for dynamic mocking (follow `heartbeatService.test.js` pattern)
- Service methods throw string error messages (follow `AgentService.js` pattern)
- Route handlers catch errors and return `{ success, error: { code, message } }` (follow `agents.js` pattern)
- Java agent uses `Map<String, Object>` for flexible JSON parsing (follow `AgentApp.java` pattern)

---

## Pending Scope Items

No deferred improvements found in previous tickets.

---

## Files NOT to Change

- `backend/src/api/agents.js` — only the route handler line 334 needs verification (no code change, it already wraps correctly)
- `frontend/src/` — no frontend changes needed
- `backend/src/migrations/` — no schema changes
- `backend/src/api/v1/index.js` — routes already mounted correctly
- `backend/src/middleware/auth.js` — agent auth unchanged
- `backend/src/controllers/` — no controller changes needed
- `backend/src/validators/` — no validation changes needed

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
