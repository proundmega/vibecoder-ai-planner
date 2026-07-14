# BP-81: Agent Bugfixes — Architect Design

## Problem Statement

Four bugs prevent the agent system from functioning correctly. The most critical is the agent detail page failure, which makes it impossible to view agent details for any agent that hasn't sent a heartbeat (i.e., all newly created agents).

## Current State

### Existing Backend

**`HeartbeatService.getAgentStatus()`** (line 24-33 of `HeartbeatService.js`):
```sql
SELECT ah.*, a.name as agent_name
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
WHERE ah.agent_id = $1
```
Bug: Queries `agent_heartbeats` as primary table. Returns `null` for agents with no heartbeat row.

**`AgentService.getAgentDailyLimit()`** (line 91-103 of `AgentService.js`):
```sql
SELECT ... FROM agents a LEFT JOIN agent_actions aa ... WHERE a.id = $2 ...
```
Bug: No parameter array passed to `pool.query()` — throws PostgreSQL error.

**`createAgentSchema`** (line 11-18 of `agents.js`):
```js
const createAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
});
```
Bug: `providerId` not validated.

**`AgentService.create()`** (line 11-31 of `AgentService.js`):
Hardcodes `rate_limit=100` and `max_actions_per_day=1000`.

### Existing Frontend

**`AgentModal.vue`**: Only has `name` input and provider dropdown. Missing `rate_limit`, `max_actions_per_day`, `api_key_expires_at` fields.

**`agents.ts`**: `createAgent(name, providerId?)` only sends two fields.

## Gap Analysis

| Gap | Impact | Fix |
|-----|--------|-----|
| `getAgentStatus` queries wrong table | Agent detail page 404s | Change primary table to `agents` |
| `getAgentDailyLimit` missing params | Method crashes | Add parameter array |
| Joi schema incomplete | No input validation | Add `providerId` field |
| Create form missing fields | No user control over limits | Add 3 form fields |
| `AgentService.create()` hardcoded | Can't customize limits | Accept params from request |

## Design

### Fix 1: Agent Detail Page (HeartbeatService)

**Change**: Rewrite `getAgentStatus()` to query from `agents` as primary table.

**Before** (line 24-33):
```sql
SELECT ah.*, a.name as agent_name
FROM agent_heartbeats ah
LEFT JOIN agents a ON a.id = ah.agent_id
WHERE ah.agent_id = $1
```

**After**:
```sql
SELECT
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
WHERE a.id = $1
```

**Impact**: The `agent_heartbeat.js` route handler (line 107-129) accesses `agent.agent_id` — this is preserved in the new SELECT. The `history` and `totalActions`/`totalCost` computation remains unchanged.

**Rationale**: Agents exist in the `agents` table from creation. Heartbeat data is optional. Starting from `agents` ensures all agents are queryable.

### Fix 2: Create Form Fields (Frontend + Backend)

**Backend changes to `agents.js`**:
1. Update `createAgentSchema` to include optional fields
2. Update route handler to pass new fields to service

**Backend changes to `AgentService.js`**:
1. Update `create()` to accept `rateLimit`, `maxActionsPerDay`, `keyExpiryDays` parameters

**Frontend changes to `AgentModal.vue`**:
1. Add `rate_limit` input (number, default 100, min 1, max 10000)
2. Add `max_actions_per_day` input (number, default 1000, min 1, max 100000)
3. Add `key_expiry_days` input (number, default 30, min 1, max 365)

**Frontend changes to `agents.ts`**:
1. Update `createAgent` signature to accept optional limit fields

### Fix 3: getAgentDailyLimit Missing Params

**Change**: Add `[agentId, date]` parameter array to `pool.query()` call.

**Before** (line 92-103):
```js
const result = await pool.query(/*sql*/ `...`);
```

**After**:
```js
const result = await pool.query(/*sql*/ `...`, [agentId, date]);
```

### Fix 4: Joi Validation for providerId

**Change**: Add optional `providerId` to `createAgentSchema`.

**Before** (line 11-18):
```js
const createAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
});
```

**After**:
```js
const createAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  providerId: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
  rateLimit: Joi.number().integer().min(1).max(10000).optional(),
  maxActionsPerDay: Joi.number().integer().min(1).max(100000).optional(),
  keyExpiryDays: Joi.number().integer().min(1).max(365).optional(),
});
```

## File-Level Impact Matrix

| File | Change Type | Lines Affected | Description |
|------|-------------|----------------|-------------|
| `backend/src/services/HeartbeatService.js` | Fix | 24-33 | Rewrite `getAgentStatus()` SQL query |
| `backend/src/services/AgentService.js` | Fix | 91-103, 11-31 | Add params to `getAgentDailyLimit`, add params to `create()` |
| `backend/src/api/agents.js` | Fix+Enhance | 11-18, 49-62 | Update Joi schema, update route handler |
| `frontend/src/components/AgentModal.vue` | Enhance | 1-44, 46-77 | Add form fields, update emit |
| `frontend/src/api/agents.ts` | Enhance | 46-48 | Update `createAgent` signature |
| `backend/src/__tests__/agentService.test.js` | Extend | New tests | Add `getAgentDailyLimit` and `create` tests |
| `frontend/src/__tests__/agents.test.js` | Extend | New tests | Add `createAgent` with params test |

## Data Flow Diagram

### Agent Detail Page (Fixed)
```
AgentDetail.vue onMounted()
  → fetchAgentDetail(agentId)
    → GET /api/v1/agents-status/:id
      → HeartbeatService.getAgentStatus(agentId)
        → SELECT FROM agents LEFT JOIN agent_heartbeats  ← FIXED
        → Returns agent row (never null for existing agents)
      → AgentService.getAgentHistory(agentId, 100)
      → Returns { ...agent, history, totalActions, totalCost }
    ← unwrap { success, data }
  ← agent.value = data
```

### Create Agent (Enhanced)
```
AgentModal.vue submit()
  → emit('created', name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays)
    → AgentList.vue handleCreate()
      → createAgent(name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays)
        → POST /api/v1/agents/create { name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays }
          → Joi validates all fields  ← FIXED
          → AgentService.create(name, apiKey, userId, providerId, rateLimit, maxActionsPerDay, keyExpiryDays)  ← FIXED
            → INSERT INTO agents with user-provided or default values
          ← Returns agent + generatedApiKey
```

## Risks and Edge Cases

| Risk | Mitigation |
|------|------------|
| `getAgentStatus` returns different shape than before | Frontend already handles missing fields with fallbacks (`agent.agent_name \|\| agent.name`) |
| New form fields could be left empty | Defaults match current hardcoded values (100, 1000, 30) |
| Old clients not sending new fields | Backend defaults to current values — fully backward compatible |
| `providerId` validation could reject valid inputs | `Joi.alternatives().try(Joi.string(), Joi.number())` covers both UUID and integer IDs |

## Alternative Designs Considered

| Option | Description | Rejected Because |
|--------|-------------|------------------|
| A: Create separate agent_detail endpoint | New route joining agents + heartbeats | Unnecessary — fixing existing query is simpler |
| B: Auto-create heartbeat row on agent creation | Ensures getAgentStatus always finds a row | Over-engineered — LEFT JOIN is the correct pattern |
| C: Use agent_heartbeats as authoritative source | Keep current query, create heartbeat on creation | Wrong data model — agents are the authoritative source |

## Pending Scope Items to Present to User

| Category | Item | Source |
|----------|------|--------|
| Security | API key rotation/expiry UI | bp-74 |
| Security | Account lockout for agents | bp-71 |
| Observability | Prometheus metrics for agents | bp-76 |
| Infrastructure | Agent container pooling | bp-80 |
| UX | Rate limit countdown UI | bp-72 |
| Testing | Cypress component tests for agent forms | bp-69 |
