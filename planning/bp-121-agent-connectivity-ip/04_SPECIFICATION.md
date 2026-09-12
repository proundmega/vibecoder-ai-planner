# 04_SPECIFICATION.md — Model Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file paths, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2026-09-11

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### MODIFY: `docker-compose.yml`

**Change**: Line 59 — extend ALLOWED_ORIGINS default in api service environment

**Position**: Line 59, inside `api` service `environment` block

**Before**:
```yaml
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002}
```

**After**:
```yaml
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002}
```

---

### MODIFY: `backend/src/services/AgentService.js`

**Add/Change method**: `getProviderConfig()` return value (lines 159-165)

**Before**:
```javascript
return { success: true, data: {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
}};
```

**After**:
```javascript
return {
  provider_type: provider.provider_type,
  api_key: decryptedKey,
  base_url: provider.base_url,
  model: provider.model,
  max_tokens: provider.max_tokens,
};
```

**Logic**: Remove the `{ success, data }` wrapper. The route handler at `backend/src/api/agents.js:334` already wraps with `res.json({ success: true, data: config })`. The final response will be `{ success: true, data: { provider_type, api_key, base_url, model, max_tokens } }` — correctly single-wrapped.

---

### MODIFY: `backend/src/services/HeartbeatService.js`

**Add/Change method**: `getAllAgents()` SQL query (lines 47-63)

**Before**:
```javascript
const result = await pool.query(
  `SELECT
    ah.agent_id,
    a.name,
    ah.status,
    ah.current_ticket_id,
    t.title as current_ticket_title,
    ah.last_seen,
    ah.current_step,
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

**After**:
```javascript
const result = await pool.query(
  `SELECT
    a.id as agent_id,
    a.name,
    ah.status,
    ah.current_ticket_id,
    t.title as current_ticket_title,
    ah.last_seen,
    ah.current_step,
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

**Key changes**:
- `FROM agents a` (was `FROM agent_heartbeats ah`) — all agents appear, even without heartbeats
- `a.id as agent_id` in SELECT — consistent with agents table primary key
- `ah.agent_id = a.id` in JOIN — flipped condition (semantically identical)
- `aa.agent_id = a.id` in LEFT JOIN — uses agents table (handles agents without heartbeats)
- `GROUP BY a.id, a.name` — group by agents table (handles agents without heartbeats)

---

### CREATE: `backend/src/__tests__/agentProviderConfig.test.js`

**Imports**:
```javascript
const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');
const { pool } = require('../db');
```

**State variables**: None (uses jest mocks)

**Functions** (exact signatures):
```javascript
describe('AgentService.getProviderConfig', () => {
  it('returns single-wrapped response (not double-wrapped)', async () => {
    // Mock: agent found, provider found
    // Assert: result has provider_type, api_key, base_url, model, max_tokens
    // Assert: result does NOT have nested { success, data } wrapper
  });

  it('decrypts API key correctly', async () => {
    // Mock: agent found, provider with encrypted key
    // Assert: api_key is decrypted value, not encrypted
  });

  it('throws AGENT_NOT_FOUND for invalid agent', async () => {
    // Mock: getAgentByApiKey returns null
    // Assert: throws Error with message 'AGENT_NOT_FOUND'
  });

  it('throws NO_PROVIDER when agent has no provider_id', async () => {
    // Mock: agent found but provider_id is null
    // Assert: throws Error with message 'NO_PROVIDER'
  });

  it('throws PROVIDER_NOT_FOUND when provider does not exist', async () => {
    // Mock: agent found, provider query returns empty rows
    // Assert: throws Error with message 'PROVIDER_NOT_FOUND'
  });
});

describe('Route: GET /api/v1/agents/:agentId/provider-config', () => {
  it('returns 200 with single-wrapped { success, data }', async () => {
    // Mock: agent found, provider found
    // POST /agents/create first to create agent, then GET /agents/:agentId/provider-config
    // Assert: response.status === 200
    // Assert: response.body.success === true
    // Assert: response.body.data has provider_type, api_key, base_url, model, max_tokens
    // Assert: response.body.data does NOT have nested { success, data }
  });

  it('returns 401 without X-API-Key header', async () => {
    // No X-API-Key header
    // Assert: response.status === 401
    // Assert: response.body.error.code === 'MISSING_API_KEY'
  });
});
```

**Template structure**: Standard Jest test file, two `describe` blocks

**Styling**: N/A (test file)

---

### CREATE: `backend/src/__tests__/agentListing.test.js`

**Imports**:
```javascript
const HeartbeatService = require('../services/HeartbeatService');
const { pool } = require('../db');
```

**State variables**: None (uses jest mocks)

**Functions** (exact signatures):
```javascript
describe('HeartbeatService.getAllAgents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns agents with heartbeats', async () => {
    // Mock: pool.query returns rows with heartbeat data
    // Assert: result contains agents with status, last_seen, etc.
  });

  it('returns agents WITHOUT heartbeats (bug fix regression test)', async () => {
    // Mock: pool.query returns row with agent from agents table but null heartbeat fields
    // Assert: result contains the agent (agent appears even without heartbeat)
    // Assert: agent_id, name are present
    // Assert: status is null (no heartbeat)
    // Assert: last_seen is null (no heartbeat)
  });

  it('returns empty array when no agents exist', async () => {
    // Mock: pool.query returns { rows: [] }
    // Assert: result.length === 0
  });

  it('orders by last_seen DESC', async () => {
    // Mock: pool.query returns multiple rows with different last_seen timestamps
    // Assert: first row has the most recent last_seen
  });

  it('agent with heartbeat but no current ticket shows null ticket fields', async () => {
    // Mock: pool.query returns row with heartbeat but null current_ticket_id
    // Assert: current_ticket_id is null
    // Assert: current_ticket_title is null
  });

  it('agent with no heartbeat shows null heartbeat fields but still appears', async () => {
    // Mock: pool.query returns row with agent but null heartbeat fields
    // Assert: agent appears in result
    // Assert: agent_id and name are present
    // Assert: status is null
    // Assert: actions_today is 0 (COALESCE)
  });
});
```

**Template structure**: Standard Jest test file, one `describe` block

**Styling**: N/A (test file)

---

### EXTEND: `backend/src/__tests__/corsValidation.test.js`

**Add to `describe('CORS Middleware', ...)` block** (after existing tests, before line 108):

```javascript
  it('should allow requests from 127.0.0.1 origins when in allowlist', async () => {
    // Note: This test uses the allowlist from beforeEach: ['http://localhost:3000', 'https://app.vibecode.ai']
    // 127.0.0.1 is NOT in this allowlist, so it should be blocked
    // The production default (docker-compose.yml) includes 127.0.0.1, but this test uses a fixed allowlist
    // To test 127.0.0.1 passing, we need a separate describe block with 127.0.0.1 in the allowlist
  });
```

**Add new `describe` block** (after line 107, before line 110):

```javascript
describe('CORS with 127.0.0.1 origins', () => {
  let app;

  beforeEach(() => {
    app = require('express')();
    app.use(cors(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:3002']));
    app.get('/test', (req, res) => {
      res.json({ success: true, data: { message: 'ok' } });
    });
  });

  it('should allow requests from http://127.0.0.1:3000', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://127.0.0.1:3000');
    
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3000');
  });

  it('should allow requests from http://127.0.0.1:3002', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://127.0.0.1:3002');
    
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3002');
  });

  it('should still block non-allowed origins like 192.168.x.x', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://192.168.3.50:3000');
    
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ERROR');
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

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

**Minimum**: 5 service tests + 2 route tests = 7 tests total

### Backend Unit Tests — Agent Listing

```
✓ [happy] getAllAgents returns agents with heartbeats
✓ [happy] getAllAgents returns agents WITHOUT heartbeats (the bug fix)
✓ [happy] getAllAgents returns empty array when no agents exist
✓ [happy] getAllAgents orders by last_seen DESC
✓ [edge] agent with heartbeat but no current ticket shows null ticket fields
✓ [edge] agent with no heartbeat shows null heartbeat fields but still appears
```

**Minimum**: 6 tests total

### Backend Unit Tests — CORS

```
✓ [happy] allows http://127.0.0.1:3000 when in allowlist
✓ [happy] allows http://127.0.0.1:3002 when in allowlist
✓ [error] blocks http://192.168.3.50:3000 when NOT in allowlist
```

**Minimum**: 3 tests total (in new describe block)

---

## Edge Cases to Handle

1. **[Agent with no heartbeat]**: `getAllAgents()` must return the agent with null heartbeat fields (status, last_seen, etc.) — the core bug fix
2. **[Agent with heartbeat but deleted from agents table]**: LEFT JOIN handles this — agent appears with null heartbeat fields (existing behavior, unchanged)
3. **[Provider config with no encrypted key]**: `decryptedKey` should be `null` when `provider.api_key_encrypted` is falsy
4. **[127.0.0.1 vs localhost]**: Both are different origin strings in CORS — both must be explicitly allowed
5. **[192.168.x.x not auto-allowed]**: LAN IPs must be explicitly configured in `ALLOWED_ORIGINS` — not auto-allowed for security

---

## Existing Code Patterns to Follow

- **Jest tests**: Use `pool.query.mockResolvedValueOnce()` for DB mocks, `jest.clearAllMocks()` in `beforeEach`
- **Service tests**: Direct `require('../services/...')`, mock `pool` from `../db`
- **Route tests**: Use `supertest` against `require('../index')` Express app
- **CORS tests**: Create minimal Express app with `cors()` middleware, test with `supertest`
- **Error handling**: Services throw string errors (e.g., `throw new Error('AGENT_NOT_FOUND')`), routes map them to HTTP status codes
- **SQL queries**: Use `$1`, `$2` parameterized queries, `COALESCE()` for null handling

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-120 | Defensive Java agent parsing for double-wrapped responses during transition | Java Agent | Future agent ticket | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `frontend/src/**` — no frontend changes needed
- `backend/src/api/agents.js` — route handler already wraps correctly, only service return changes
- `backend/src/api/v1/agentHeartbeat.js` — no changes needed
- `backend/src/migrations/**` — no DB changes needed
- `backend/src/utils/crypto.js` — decrypt function unchanged
- `docker-compose.test.yml` — no test container changes needed

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
