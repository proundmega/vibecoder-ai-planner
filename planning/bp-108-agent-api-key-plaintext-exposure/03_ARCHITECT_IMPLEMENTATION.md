# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Plan

## Ticket: bp-108 — Remove Plaintext API Key from Agent List Response

**Status**: planned
**Priority**: P2
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-07-25
**Date completed**: 
**PR**: 
**Branch**: fix/bp-108-agent-api-key-plaintext-exposure
**Scope**: Backend + Frontend

**Dependencies**: bp-102 (completed)

---

### a) Purpose

bp-102 masked `api_key_hash` and `api_key_hash_prefix` in `GET /agents` but left the plaintext `api_key` in the response. This ticket removes the plaintext `api_key` from the list response entirely and updates the frontend to stop depending on it.

---

### b) Actions

#### Implementation Order

1. **Extend `maskAgentList()` in backend** — `backend/src/api/agents.js`
   - Add `delete masked.api_key` to the masking function
   - *Depends on*: nothing

2. **Add JWT auth to agent history endpoint** — `backend/src/api/agents.js`
   - Add `verifyTokenOrAgent` middleware to `GET /agents/:agentId/history`
   - Add `requireAnyPermission('AGENT_READ')` for authorization
   - Keep `x-api-key` as fallback for agent-to-agent calls
   - *Depends on*: Step 1

3. **Update backend tests** — `backend/src/__tests__/agentMasking.test.js`
   - Add test: `api_key` NOT in list response
   - *Depends on*: Step 1

4. **Update frontend Agent interface** — `frontend/src/api/agents.ts`
   - Remove `api_key` from `Agent` interface
   - *Depends on*: Step 1

5. **Update frontend AgentList.vue** — `frontend/src/views/AgentList.vue`
   - Remove `formatKeyPreview(agent.api_key)` usage
   - Use `getAgentKeyInfo(agentId)` for key preview or show placeholder
   - *Depends on*: Step 4

6. **Update frontend AIAssistant.vue** — `frontend/src/views/AIAssistant.vue`
   - Remove `apiKey` ref and `agent?.api_key` dependency
   - Call `getAgentHistory()` without `x-api-key` header (JWT handles auth)
   - *Depends on*: Step 2, Step 4

7. **Update frontend tests** — `frontend/src/__tests__/agentEdit.test.ts`
   - Remove `api_key` from mock data
   - *Depends on*: Step 4

8. **Verify & build**
   - Run `cd backend && npm test`
   - Run `cd frontend && npm test -- --run`
   - Run `cd frontend && npm run typecheck`
   - Run `cd frontend && npm run build`
   - *Depends on*: all above

---

### c) Per-File Action Plan

#### `backend/src/api/agents.js` (MODIFY)

**Change 1: Extend `maskAgentList()`**
- **Position**: line 24-31 (existing function)
- **Change**: Add `delete masked.api_key;` before the hash masking lines
- **Result**:
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

**Change 2: Add JWT auth to history endpoint**
- **Position**: line 217 (the `router.get('/:agentId/history', ...)` handler)
- **Change**: Add `verifyTokenOrAgent` and `requireAnyPermission('AGENT_READ')` middleware
- **Current**: `router.get('/:agentId/history', async (req, res, _next) => {`
- **New**: `router.get('/:agentId/history', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res, _next) => {`
- **Also**: Update the handler to check JWT auth first, fall back to `x-api-key`:
```javascript
router.get('/:agentId/history', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res, _next) => {
  try {
    let agent;
    // JWT auth (preferred)
    if (req.user && req.user.userId) {
      const agents = await AgentService.list(req.user.userId);
      agent = agents.find(a => a.id === req.params.agentId);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
    } else {
      // Fallback: x-api-key auth for agent-to-agent calls
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
    // ... rest of handler unchanged
```

**Imports needed**: None new (already imported `verifyTokenOrAgent` and `requireAnyPermission`)

#### `frontend/src/api/agents.ts` (MODIFY)

**Change: Remove `api_key` from `Agent` interface**
- **Position**: line 10-21 (the `Agent` interface)
- **Remove**: `api_key: string | null` (line 13)
- **Result**:
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

#### `frontend/src/views/AgentList.vue` (MODIFY)

**Change: Replace `formatKeyPreview(agent.api_key)` with key preview from API**
- **Position**: line 229 (the `<td>` showing key preview)
- **Current**: `<td><code>{{ formatKeyPreview(agent.api_key) }}</code></td>`
- **Options**:
  - **Option A (simple)**: Show a masked placeholder: `<td><code>••••••••</code></td>` with a "View" link to the key endpoint
  - **Option B (on-demand)**: Call `getAgentKeyInfo(agent.id)` for each agent to get the preview (N+1, but agents list is small)
- **Recommended**: Option A for simplicity. The key preview is already available via the dedicated `/agents/:id/key` endpoint.

#### `frontend/src/views/AIAssistant.vue` (MODIFY)

**Change: Remove `api_key` dependency**
- **Position**: line 14 (the `apiKey` ref), line 34 (the assignment)
- **Remove**: `const apiKey = ref('')` and `apiKey.value = agent?.apiKey || agent?.api_key || ''`
- **Change**: `getAgentHistory(selectedAgentId.value, apiKey.value)` → `getAgentHistory(selectedAgentId.value)` (no API key needed, JWT handles auth)
- **Note**: `getAgentHistory()` in `agents.ts` already handles the case where `apiKey` is null — it just doesn't send the `x-api-key` header.

#### `backend/src/__tests__/agentMasking.test.js` (MODIFY)

**Add test case**:
```javascript
it('GET /agents does not include api_key in response', async () => {
  const res = await request(app)
    .get('/api/v1/agents')
    .set('Authorization', 'Bearer mock-token');

  expect(res.statusCode).toBe(200);
  expect(res.body.agents[0]).not.toHaveProperty('api_key');
});
```

**Position**: Add after the existing "does not mask api_key" test (line 89-96)

#### `frontend/src/__tests__/agentEdit.test.ts` (MODIFY)

**Change: Remove `api_key` from mock data**
- **Position**: line 32-33 (the `mockAgents` array)
- **Remove**: `api_key: 'ak_12345678'` and `api_key: 'ak_87654321'`

---

### d) Dependencies

- `AgentService.list()` — no change needed (returns full rows, masking in controller)
- `verifyTokenOrAgent` middleware — reuse for history endpoint
- `requireAnyPermission` middleware — reuse for history endpoint
- `getAgentKeyInfo()` in `agents.ts` — already exists
- `getAgentHistory()` in `agents.ts` — already handles null apiKey

---

### e) Risks/Edge Cases

- **[History endpoint backward compatibility]**: Agent-to-agent calls using `x-api-key` still work (fallback path preserved)
- **[Agent with null api_key]**: `delete masked.api_key` is a no-op on null — no crash
- **[AgentList.vue key display]**: Shows placeholder instead of truncated key — acceptable UX tradeoff
- **[AIAssistant.vue history]**: Now uses JWT auth — requires user to be logged in (already the case for this view)

---

### f) Testing

#### Backend Unit Tests
- [x] Test file: `backend/src/__tests__/agentMasking.test.js` — EXTENDED
  - Add: `api_key` NOT in list response
  - Existing tests still pass (hash masking, key preview, create endpoint, null handling)

#### Frontend Unit Tests
- [ ] Test file: `frontend/src/__tests__/agentEdit.test.ts` — EXTENDED
  - Remove `api_key` from mock data
  - Verify agent list renders without `api_key`
- [ ] Test file: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED if response shape changed
  - Verify `api_key` is not in agent list response schema

#### Frontend Contract Tests
- [ ] Response schema updated in `frontend/src/api/validator.ts` if `api_key` is validated
- [ ] Contract test: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED

---

### g) Migration Notes

NONE — no database changes.

---

### h) Files Changed

**Backend:**
```
backend/src/api/agents.js              → MODIFY (maskAgentList + history endpoint auth)
backend/src/__tests__/agentMasking.test.js → MODIFY (add api_key removal test)
```

**Frontend:**
```
frontend/src/api/agents.ts             → MODIFY (remove api_key from Agent interface)
frontend/src/views/AgentList.vue       → MODIFY (remove formatKeyPreview dependency)
frontend/src/views/AIAssistant.vue     → MODIFY (remove api_key dependency)
frontend/src/__tests__/agentEdit.test.ts → MODIFY (remove api_key from mocks)
```

---

### Pending Scope Items to Present to User

No deferred improvements found in previous tickets that are directly blocking this ticket.

---

### i) Code Review Checklist

- [ ] Backend `maskAgentList()` removes `api_key` AND masks hashes
- [ ] Backend history endpoint accepts JWT auth with `x-api-key` fallback
- [ ] Frontend `Agent` interface no longer includes `api_key`
- [ ] Frontend `AgentList.vue` doesn't depend on `api_key` from list
- [ ] Frontend `AIAssistant.vue` works without `api_key` from list
- [ ] Backend tests verify `api_key` not in list response
- [ ] Frontend tests pass with updated mock data
- [ ] All tests written and passing
- [ ] OpenAPI spec updated if response shape changed
- [ ] Generated TypeScript types regenerated if needed
- [ ] `npm run typecheck` passes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60%
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
4. [ ] Frontend: `npm run lint` passes
5. [ ] Frontend: `npm run typecheck` passes
6. [ ] Frontend: `npm run build` passes
7. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
8. [ ] `GET /api/v1/agents` returns agents without `api_key` field
9. [ ] `GET /api/v1/agents/:id/key` still returns key preview
10. [ ] `GET /api/v1/agents/:id/history` works with JWT auth
11. [ ] AgentList.vue renders correctly (key preview column shows placeholder)
12. [ ] AIAssistant.vue can fetch agent history

---

*Fill in all sections before starting implementation. Update status as work progresses.*
