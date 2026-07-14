# BP-81: Agent Bugfixes — Implementation Plan

## Ticket Header

| Field | Value |
|-------|-------|
| **Ticket ID** | BP-81 |
| **Title** | Agent Bugfixes |
| **Status** | Ready for Implementation |
| **Priority** | P1 (High) |
| **Effort** | Small |
| **Author** | opencode |
| **Created** | 2026-07-14 |
| **Branch** | `fix/bp-81-agent-bugfixes` |
| **Scope** | Backend services, API routes, frontend components |
| **Dependencies** | None |

## a) Purpose

Four bugs prevent the agent system from working:
1. Agent detail page 404s for agents with no heartbeat
2. Create form missing configurable fields
3. `getAgentDailyLimit()` crashes due to missing SQL params
4. Joi schema doesn't validate `providerId`

## b) Implementation Order

### Phase 1: Backend Fixes (no frontend dependency)

**Step 1**: Fix `HeartbeatService.getAgentStatus()` — standalone fix, no dependencies
**Step 2**: Fix `AgentService.getAgentDailyLimit()` — standalone fix, no dependencies
**Step 3**: Update `createAgentSchema` Joi validation in `agents.js`
**Step 4**: Update `AgentService.create()` to accept new parameters
**Step 5**: Update `POST /agents/create` route handler to pass new fields

### Phase 2: Frontend Enhancements (depends on Phase 1)

**Step 6**: Update `agents.ts` API client `createAgent` signature
**Step 7**: Update `AgentModal.vue` to add new form fields

### Phase 3: Tests (depends on Phase 1 + 2)

**Step 8**: Add backend regression tests for all fixes
**Step 9**: Add frontend tests for `createAgent` with new params

## c) Per-File Action Plan

### File 1: `backend/src/services/HeartbeatService.js`

**Method**: `getAgentStatus(agentId)` (lines 24-33)

**Action**: Replace SQL query to use `agents` as primary table.

**Before** (lines 25-31):
```js
const result = await pool.query(
  `SELECT ah.*, a.name as agent_name
   FROM agent_heartbeats ah
   LEFT JOIN agents a ON a.id = ah.agent_id
   WHERE ah.agent_id = $1`,
  [agentId]
);
```

**After**:
```js
const result = await pool.query(
  `SELECT
    a.id as agent_id,
    a.name as agent_name,
    a.owner_id,
    a.rate_limit,
    a.max_actions_per_day,
    ah.last_seen,
    ah.current_ticket_id,
    ah.current_step,
    ah.memory_usage,
    ah.cpu_usage,
    COALESCE(ah.status, 'offline') as status
  FROM agents a
  LEFT JOIN agent_heartbeats ah ON ah.agent_id = a.id
  WHERE a.id = $1`,
  [agentId]
);
```

**Error cases**: Returns `null` only if agent doesn't exist in `agents` table (correct behavior).

---

### File 2: `backend/src/services/AgentService.js`

**Method 1**: `getAgentDailyLimit(agentId, date)` (lines 91-103)

**Action**: Add missing parameter array.

**Before** (lines 92-103):
```js
const result = await pool.query(/*sql*/ `
  SELECT
    a.rate_limit,
    a.max_actions_per_day,
    COUNT(aa.id) as actions_today
  FROM agents a
  LEFT JOIN agent_actions aa
    ON aa.agent_id = a.id
    AND DATE(aa.created_at) = DATE($1)
  WHERE a.id = $2
  GROUP BY a.id
`);
```

**After**:
```js
const result = await pool.query(/*sql*/ `
  SELECT
    a.rate_limit,
    a.max_actions_per_day,
    COUNT(aa.id) as actions_today
  FROM agents a
  LEFT JOIN agent_actions aa
    ON aa.agent_id = a.id
    AND DATE(aa.created_at) = DATE($1)
  WHERE a.id = $2
  GROUP BY a.id
`, [agentId, date]);
```

**Method 2**: `create(name, apiKey, userId, providerId)` (lines 11-31)

**Action**: Add optional parameters for rate limit, max actions, key expiry.

**Before** (line 11):
```js
async create(name, apiKey, userId, providerId = null) {
```

**After**:
```js
async create(name, apiKey, userId, providerId = null, rateLimit = 100, maxActionsPerDay = 1000, keyExpiryDays = 30) {
```

**Before** (lines 21-22):
```js
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);
```

**After**:
```js
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + keyExpiryDays);
```

**Before** (line 28):
```js
[name, apiKeyHash, apiKeyHashPrefix, expiresAt, userId, providerId, 100, 1000]
```

**After**:
```js
[name, apiKeyHash, apiKeyHashPrefix, expiresAt, userId, providerId, rateLimit, maxActionsPerDay]
```

---

### File 3: `backend/src/api/agents.js`

**Schema**: `createAgentSchema` (lines 11-18)

**Action**: Add optional fields to Joi schema.

**Before** (lines 11-18):
```js
const createAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
});
```

**After**:
```js
const createAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
  providerId: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
  rateLimit: Joi.number().integer().min(1).max(10000).optional(),
  maxActionsPerDay: Joi.number().integer().min(1).max(100000).optional(),
  keyExpiryDays: Joi.number().integer().min(1).max(365).optional(),
});
```

**Route Handler**: `POST /create` (lines 49-62)

**Action**: Pass new fields to service.

**Before** (lines 51, 53):
```js
const { name, providerId } = req.body;
...
const agent = await AgentService.create(name, apiKey, req.user.userId, providerId || null);
```

**After**:
```js
const { name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays } = req.body;
...
const agent = await AgentService.create(name, apiKey, req.user.userId, providerId || null, rateLimit, maxActionsPerDay, keyExpiryDays);
```

---

### File 4: `frontend/src/api/agents.ts`

**Function**: `createAgent` (lines 46-48)

**Action**: Add optional parameters.

**Before** (lines 46-48):
```ts
export function createAgent(name: string, providerId?: string): Promise<Agent & { generatedApiKey: string }> {
  return post<Agent & { generatedApiKey: string }>('/api/v1/agents/create', { name, providerId: providerId || undefined })
}
```

**After**:
```ts
export interface CreateAgentParams {
  name: string
  providerId?: string
  rateLimit?: number
  maxActionsPerDay?: number
  keyExpiryDays?: number
}

export function createAgent(params: CreateAgentParams): Promise<Agent & { generatedApiKey: string }> {
  return post<Agent & { generatedApiKey: string }>('/api/v1/agents/create', {
    name: params.name,
    providerId: params.providerId || undefined,
    rateLimit: params.rateLimit,
    maxActionsPerDay: params.maxActionsPerDay,
    keyExpiryDays: params.keyExpiryDays,
  })
}
```

---

### File 5: `frontend/src/components/AgentModal.vue`

**Action**: Add form fields for `rate_limit`, `max_actions_per_day`, `key_expiry_days`.

**Add state variables** (after line 17):
```js
const rateLimit = ref(100)
const maxActionsPerDay = ref(1000)
const keyExpiryDays = ref(30)
```

**Update emit in `submit()`** (line 42):
```js
emit('created', name.value.trim(), props.selectedProvider, rateLimit.value, maxActionsPerDay.value, keyExpiryDays.value)
```

**Update `close()`** (after line 27):
```js
rateLimit.value = 100
maxActionsPerDay.value = 1000
keyExpiryDays.value = 30
```

**Add form fields in template** (after provider dropdown, before modal-actions):
```vue
<div class="form-row">
  <div class="form-group">
    <label>Rate Limit (requests/min)</label>
    <input type="number" v-model.number="rateLimit" min="1" max="10000" :disabled="loading" />
  </div>
  <div class="form-group">
    <label>Max Actions/Day</label>
    <input type="number" v-model.number="maxActionsPerDay" min="1" max="100000" :disabled="loading" />
  </div>
</div>
<div class="form-group">
  <label>API Key Expiry (days)</label>
  <input type="number" v-model.number="keyExpiryDays" min="1" max="365" :disabled="loading" />
</div>
```

---

### File 6: `frontend/src/views/AgentList.vue`

**Action**: Update `handleCreate` to pass new fields.

**Before** (line 69):
```js
async function handleCreate(name, providerId) {
```

**After**:
```js
async function handleCreate(name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays) {
```

**Before** (line 72):
```js
await createAgent(name, providerId)
```

**After**:
```js
await createAgent({ name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays })
```

---

### File 7: `backend/src/__tests__/agentService.test.js`

**Action**: Add test for `getAgentDailyLimit` with params, and `create` with custom limits.

**New test** (after `incrementDailyUsage` describe block):
```js
describe('getAgentDailyLimit', () => {
  it('returns daily limit with correct parameters', async () => {
    const mockRow = { rate_limit: 200, max_actions_per_day: 5000, actions_today: 5 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await AgentService.getAgentDailyLimit('a1', new Date('2026-01-15'));

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['a1', new Date('2026-01-15')]
    );
    expect(result.used).toBe(5);
    expect(result.limit).toBe(5000);
    expect(result.available).toBe(4995);
  });

  it('returns default when agent not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await AgentService.getAgentDailyLimit('nonexistent');

    expect(result.available).toBe(0);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(100);
  });
});
```

**Extend `create` test**:
```js
it('creates agent with custom limits', async () => {
  const mockRow = { id: 'a1', name: 'Custom Agent', api_key_expires_at: new Date() };
  pool.query.mockResolvedValueOnce({ rows: [mockRow] });

  const result = await AgentService.create('Custom Agent', 'key-456', 'user-1', 'prov-1', 500, 5000, 60);

  expect(pool.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO agents'),
    expect.arrayContaining(['Custom Agent', expect.any(String), expect.any(String), expect.any(Date), 'user-1', 'prov-1', 500, 5000])
  );
  expect(result.api_key).toBe('key-456');
});
```

---

### File 8: `frontend/src/__tests__/agents.test.js`

**Action**: Update `createAgent` test to use new interface.

**Before** (lines 26-33):
```js
it('createAgent calls post with correct URL', async () => {
  const { post } = await import('../api/client')
  post.mockResolvedValue({ id: 'agent-1', name: 'Test Agent' })

  await agents.createAgent('Test Agent')

  expect(post).toHaveBeenCalledWith('/api/v1/agents/create', { name: 'Test Agent' })
})
```

**After**:
```js
it('createAgent calls post with correct URL and params', async () => {
  const { post } = await import('../api/client')
  post.mockResolvedValue({ id: 'agent-1', name: 'Test Agent' })

  await agents.createAgent({ name: 'Test Agent', rateLimit: 200, maxActionsPerDay: 5000 })

  expect(post).toHaveBeenCalledWith('/api/v1/agents/create', {
    name: 'Test Agent',
    providerId: undefined,
    rateLimit: 200,
    maxActionsPerDay: 5000,
    keyExpiryDays: undefined,
  })
})

it('createAgent sends minimal params', async () => {
  const { post } = await import('../api/client')
  post.mockResolvedValue({ id: 'agent-1', name: 'Test Agent' })

  await agents.createAgent({ name: 'Test Agent' })

  expect(post).toHaveBeenCalledWith('/api/v1/agents/create', {
    name: 'Test Agent',
    providerId: undefined,
    rateLimit: undefined,
    maxActionsPerDay: undefined,
    keyExpiryDays: undefined,
  })
})
```

## d) Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Backend services | ✅ Ready | `AgentService`, `HeartbeatService` exist |
| Frontend API client | ✅ Ready | `agents.ts` exists |
| Frontend UI | ✅ Ready | `AgentModal.vue`, `AgentList.vue` exist |
| Database | ✅ Ready | All columns exist in `agents` table |
| Test infrastructure | ✅ Ready | Jest (backend), Vitest (frontend) configured |

## e) Risks/Edge Cases

| Risk | Mitigation |
|------|------------|
| Frontend `AgentDetail.vue` uses `agent.agent_id` from heartbeat | New query returns `a.id as agent_id` — compatible |
| Old API clients not sending new fields | Backend defaults to current values (100, 1000, 30) |
| `AgentList.vue` `handleCreate` signature changes | Must update both `AgentModal.vue` emit and `AgentList.vue` handler |

## f) Testing

### Test-First Requirement
1. Create empty test stubs in `agentService.test.js` and `agents.test.js`
2. Implement production code
3. Fill in test stubs with actual assertions

### Backend Unit Tests
- `getAgentDailyLimit` with valid agent → returns correct counts
- `getAgentDailyLimit` with nonexistent agent → returns defaults
- `create` with custom limits → persists to database
- `create` with defaults → uses hardcoded values

### Frontend Unit Tests
- `createAgent` with all params → sends correct payload
- `createAgent` with minimal params → sends undefined for optional fields

## g) Migration Notes

- No migration required
- No schema changes
- All columns already exist in `agents` table

## h) Files Changed

| File | Action | Lines Changed |
|------|--------|---------------|
| `backend/src/services/HeartbeatService.js` | Fix | ~10 lines replaced |
| `backend/src/services/AgentService.js` | Fix | ~5 lines modified |
| `backend/src/api/agents.js` | Fix+Enhance | ~10 lines modified |
| `frontend/src/api/agents.ts` | Enhance | ~15 lines modified |
| `frontend/src/components/AgentModal.vue` | Enhance | ~30 lines added |
| `frontend/src/views/AgentList.vue` | Enhance | ~3 lines modified |
| `backend/src/__tests__/agentService.test.js` | Extend | ~40 lines added |
| `frontend/src/__tests__/agents.test.js` | Extend | ~30 lines modified |

## i) Code Review Checklist

- [ ] All SQL queries use parameterized statements
- [ ] No hardcoded values where parameters should be used
- [ ] Joi validation covers all user-input fields
- [ ] Default values match existing behavior
- [ ] Error messages are clear and actionable
- [ ] No breaking changes to API response shape
- [ ] No new dependencies introduced
- [ ] No secrets or keys logged
- [ ] Tests cover happy path and error cases
- [ ] Frontend components use `<script setup>` pattern
- [ ] TypeScript types are correct
- [ ] No unused imports or variables

## j) Post-Deploy Verification

1. Create a new agent via the UI → verify all fields appear
2. Create agent with custom limits → verify they persist
3. Click on the new agent → verify detail page loads (not 404)
4. Verify default values work when fields are left empty
5. Run `npm test` in `backend/` → all tests pass
6. Run `npm test -- --run` in `frontend/` → all tests pass
7. Run `npm run lint` in both → no new errors
8. Run `npm run typecheck` in `frontend/` → passes

## Pending Scope Items to Present to User

| Category | Item | Source |
|----------|------|--------|
| Security | API key rotation/expiry UI | bp-74 |
| Security | Account lockout for agents | bp-71 |
| Observability | Prometheus metrics for agents | bp-76 |
| Infrastructure | Agent container pooling | bp-80 |
| UX | Rate limit countdown UI | bp-72 |
| Testing | Cypress component tests for agent forms | bp-69 |
