# 04_SPECIFICATION.md — Remove Plaintext API Key from Agent List Response

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2026-07-25

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

---

## File Operations

### MODIFY: `backend/src/api/agents.js`

**Change 1: Extend `maskAgentList()` function** (line 24-31)

Current:
```javascript
function maskAgentList(agents) {
  return agents.map(agent => {
    const masked = { ...agent };
    if (masked.api_key_hash) masked.api_key_hash = '***';
    if (masked.api_key_hash_prefix) masked.api_key_hash_prefix = '***';
    return masked;
  });
}
```

New:
```javascript
function maskAgentList(agents) {
  return agents.map(agent => {
    const masked = { ...agent };
    delete masked.api_key;
    if (masked.api_key_hash) masked.api_key_hash = '***';
    if (masked.api_key_hash_prefix) masked.api_key_hash_prefix = '***';
    return masked;
  });
}
```

**Change 2: Add JWT auth to history endpoint** (line 217)

Current:
```javascript
router.get('/:agentId/history', async (req, res, _next) => {
```

New:
```javascript
router.get('/:agentId/history', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res, _next) => {
```

Also update the handler body to check JWT first, then fall back to `x-api-key`:
```javascript
router.get('/:agentId/history', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res, _next) => {
  try {
    let agent;
    if (req.user && req.user.userId) {
      const agents = await AgentService.list(req.user.userId);
      agent = agents.find(a => a.id === req.params.agentId);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
    } else {
      const apiKey = req.headers['x-api-key'];
      if (apiKey) {
        agent = await AgentService.getAgentByApiKey(apiKey);
        if (!agent || agent.id !== req.params.agentId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } else {
        return res.status(401).json({ error: 'Authentication required' });
      }
    }

    const history = await AgentService.getAgentHistory(agent.id, 100);
    // ... rest of handler unchanged from line 231 onward
```

### MODIFY: `frontend/src/api/agents.ts`

**Remove `api_key` from `Agent` interface** (line 10-21)

Current:
```typescript
export interface Agent {
  id: number
  name: string
  api_key: string | null
  owner_id: number
  rate_limit: number
  max_actions_per_day: number
  current_daily_usage: number
  last_reset_at: string | null
  created_at: string
  updated_at: string
}
```

New:
```typescript
export interface Agent {
  id: number
  name: string
  owner_id: number
  rate_limit: number
  max_actions_per_day: number
  current_daily_usage: number
  last_reset_at: string | null
  created_at: string
  updated_at: string
}
```

### MODIFY: `frontend/src/views/AgentList.vue`

**Remove `formatKeyPreview(agent.api_key)` usage** (line 229)

Current:
```html
<td><code>{{ formatKeyPreview(agent.api_key) }}</code></td>
```

New (show placeholder, link to key endpoint):
```html
<td><code>••••••••</code> <router-link :to="`/agents/${agent.id}`" class="link-details">View</router-link></td>
```

**Also remove** the `formatKeyPreview` function (line 118-121) since it's no longer used.

### MODIFY: `frontend/src/views/AIAssistant.vue`

**Remove `api_key` dependency** (lines 14, 34, 141)

1. Remove `const apiKey = ref('')` (line 14)
2. Remove `apiKey.value = agent?.apiKey || agent?.api_key || ''` (line 34)
3. Change `await getAgentHistory(selectedAgentId.value, apiKey.value)` (line 141) to `await getAgentHistory(selectedAgentId.value)`

### MODIFY: `backend/src/__tests__/agentMasking.test.js`

**Add test case** after the existing "does not mask api_key" test (after line 96):

```javascript
it('GET /agents does not include api_key in response', async () => {
  const res = await request(app)
    .get('/api/v1/agents')
    .set('Authorization', 'Bearer mock-token');

  expect(res.statusCode).toBe(200);
  expect(res.body.agents[0]).not.toHaveProperty('api_key');
});
```

### MODIFY: `frontend/src/__tests__/agentEdit.test.ts`

**Remove `api_key` from mock data** (lines 32-33)

Current:
```typescript
const mockAgents = [
  { id: 'a1', name: 'Agent Alpha', provider_name: 'claude', api_key: 'ak_12345678', rate_limit: 100, created_at: '2026-01-15' },
  { id: 'a2', name: 'Agent Beta', provider_name: 'openai', api_key: 'ak_87654321', rate_limit: 200, created_at: '2026-02-20' },
]
```

New:
```typescript
const mockAgents = [
  { id: 'a1', name: 'Agent Alpha', provider_name: 'claude', rate_limit: 100, created_at: '2026-01-15' },
  { id: 'a2', name: 'Agent Beta', provider_name: 'openai', rate_limit: 200, created_at: '2026-02-20' },
]
```

---

## Test Expectations

### Backend Unit Tests — Agent API Key Removal
```
✓ [happy] GET /agents response does not contain api_key field
✓ [happy] GET /agents response still masks api_key_hash to '***'
✓ [happy] GET /agents response still masks api_key_hash_prefix to '***'
✓ [happy] GET /agents/:agentId/key returns key preview (unchanged)
✓ [happy] POST /agents/create still returns generatedApiKey (unchanged)
✓ [edge] GET /agents handles agent with null api_key (no crash)
✓ [auth] GET /agents/:agentId/history accepts JWT auth
✓ [auth] GET /agents/:agentId/history falls back to x-api-key auth
```

### Frontend Unit Tests — Agent List
```
✓ [ui] AgentList renders agent names without api_key
✓ [ui] AgentList shows key placeholder instead of truncated key
✓ [api] listAgents() returns agents without api_key field
```

### Frontend Contract Tests
```
✓ [shape] Agent response does not contain api_key field
✓ [shape] Agent response still contains name, id, rate_limit
```

---

## Edge Cases to Handle

1. **[Agent with null api_key]**: `delete masked.api_key` is a no-op on null/undefined — no crash
2. **[Agent with revoked key]**: `api_key` is null after revocation — same as above
3. **[POST /agents/create]**: Still returns `generatedApiKey` — NOT affected by this change
4. **[Agent self-auth via x-api-key]**: Agent-to-agent calls still use `x-api-key` header — the fallback path in history endpoint preserves this
5. **[AIAssistant.vue without apiKey]**: `getAgentHistory(id)` without second arg works — the function already handles null/undefined apiKey by not sending the header

---

## Existing Code Patterns to Follow

- Backend uses CommonJS (`require`, `module.exports`)
- Response format: `{ agents }` or `{ agents: [...] }`
- Masking pattern: `if (field) field = '***'`
- Helper functions defined at module level
- Frontend API client uses `get`, `post`, `put`, `del` from `./client`
- Frontend components use `<script setup>` syntax (Vue 3 Composition API)

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-102 | Credentials API `api_key_encrypted` masking | Security | Could extend this ticket | ☐ |
| 2 | bp-102 | Agent history endpoint JWT auth | Security | Implemented in this ticket | ☐ |

---

## Files NOT to Change

- `backend/src/services/AgentService.js` — service-level operations unchanged
- `backend/src/api/terminal.js` — WebSocket auth uses different mechanism
- `backend/src/api/credentials.js` — already handled via `keyMasked` field
- `frontend/src/api/providers.ts` — provider API keys handled separately

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
