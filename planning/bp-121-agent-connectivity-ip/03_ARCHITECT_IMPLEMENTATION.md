# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bp-121 — Agent Connectivity Fixes for Non-Locality Deployments

**Status**: planned
**Priority**: P0
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-09-11
**Date completed**: {{DATE}}
**PR**: {{link}}
**Branch**: fix/bp-121-agent-connectivity-ip
**Scope**: Backend

**Dependencies**: None. This ticket fixes three independent bugs identified in bp-120 (which was planned but never implemented).

---

### a) Purpose

Java agents deployed on non-localhost hosts (e.g., `http://192.168.3.50:3000`) fail to function. Three backend bugs prevent agents from: (1) passing CORS validation, (2) receiving provider config, and (3) appearing in the agents list. This ticket fixes all three.

---

### b) Actions

**CRITICAL**: Before implementing, check if the feature can be added to existing code rather than creating new files. All three fixes modify existing code.

#### Implementation Order

1. **[Fix 1] CORS — extend production default** — `docker-compose.yml`
   - Add `127.0.0.1:3000` and `127.0.0.1:3002` to ALLOWED_ORIGINS default
   - *Depends on*: nothing

2. **[Fix 2] Provider config — remove double-wrap** — `backend/src/services/AgentService.js`
   - Remove `{ success, data }` wrapper from `getProviderConfig()` return
   - *Depends on*: nothing

3. **[Fix 3] Agent listing — swap FROM/JOIN** — `backend/src/services/HeartbeatService.js`
   - Change SQL from `FROM agent_heartbeats LEFT JOIN agents` to `FROM agents LEFT JOIN agent_heartbeats`
   - *Depends on*: nothing

4. **[Tests] Create regression tests** — new test files
   - *Depends on*: Steps 1-3 (tests verify the fixed behavior)

5. **[Tests] Extend CORS tests** — existing test file
   - *Depends on*: Step 1

#### Phase 1: Backend Fixes

**Step 1: Fix CORS production default**

File: `docker-compose.yml`, line 59

```yaml
# Before:
- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002}

# After:
- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002}
```

**Step 2: Fix provider config double-wrap**

File: `backend/src/services/AgentService.js`, lines 159-165

```javascript
// Before (lines 159-165):
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

The route handler at `backend/src/api/agents.js:334` already wraps: `res.json({ success: true, data: config })`. So the final response will be correctly single-wrapped.

**Step 3: Fix agent listing SQL**

File: `backend/src/services/HeartbeatService.js`, lines 47-63

```sql
-- Before (lines 47-63):
SELECT
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
ORDER BY ah.last_seen DESC NULLS LAST

-- After:
SELECT
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
ORDER BY ah.last_seen DESC NULLS LAST
```

Key changes:
- `FROM agents a` (was `FROM agent_heartbeats ah`) — all agents appear
- `a.id as agent_id` in SELECT — consistent with agents table primary key
- `ah.agent_id = a.id` in JOIN — flipped condition (semantically identical)
- `aa.agent_id = a.id` in LEFT JOIN — uses agents table (handles agents without heartbeats)
- `GROUP BY a.id, a.name` — group by agents table (handles agents without heartbeats)

#### Phase 2: Tests

**Step 4: Create `backend/src/__tests__/agentProviderConfig.test.js`**

New test file. Tests `AgentService.getProviderConfig()` and the route handler.

Test cases:
- `getProviderConfig returns single-wrapped response (not double-wrapped)`
- `getProviderConfig decrypts API key correctly`
- `getProviderConfig throws AGENT_NOT_FOUND for invalid agent`
- `getProviderConfig throws NO_PROVIDER when agent has no provider_id`
- `getProviderConfig throws PROVIDER_NOT_FOUND when provider doesn't exist`
- `Route: GET /agents/:agentId/provider-config returns single-wrapped { success, data }`
- `Route: GET /agents/:agentId/provider-config without X-API-Key returns 401`

**Step 5: Create `backend/src/__tests__/agentListing.test.js`**

New test file. Tests `HeartbeatService.getAllAgents()`.

Test cases:
- `getAllAgents returns agents with heartbeats`
- `getAllAgents returns agents WITHOUT heartbeats (bug fix regression test)`
- `getAllAgents returns empty array when no agents exist`
- `getAllAgents orders by last_seen DESC`
- `agent with heartbeat but no current ticket shows null ticket fields`
- `agent with no heartbeat shows null heartbeat fields but still appears`

**Step 6: Extend `backend/src/__tests__/corsValidation.test.js`**

Add test cases for `127.0.0.1` origins:
- `allows http://127.0.0.1:3000 origin`
- `allows http://127.0.0.1:3002 origin`
- `blocks http://192.168.1.100:3000 origin (not in allowlist)`

#### Phase 3: Verification

1. Run `npm test` — all unit tests pass
2. Run `npm run test:coverage` — 60% minimum coverage
3. Run `npm run test:integration` — integration tests pass
4. Run `cd backend && bash integration-test/run.sh --only` — bash suite passes
5. Run `npm run lint` — no lint errors

---

### c) Per-File Action Plan

#### `docker-compose.yml` (MODIFY)
- **Change**: Line 59 — extend ALLOWED_ORIGINS default
- **Before**: `${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002}`
- **After**: `${ALLOWED_ORIGINS:-http://localhost:3000,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3002}`
- **Position**: Line 59, api service environment block

#### `backend/src/services/AgentService.js` (MODIFY)
- **Change**: Lines 159-165 — remove `{ success, data }` wrapper from `getProviderConfig()` return
- **Logic**: Service returns flat object; route handler wraps with `{ success, data }`
- **Position**: Lines 159-165, inside `getProviderConfig()` method

#### `backend/src/services/HeartbeatService.js` (MODIFY)
- **Change**: Lines 47-63 — swap FROM/JOIN order in `getAllAgents()` SQL
- **Logic**: Query FROM agents table so all agents appear, even without heartbeats
- **Position**: Lines 47-63, inside `getAllAgents()` method

#### `backend/src/__tests__/agentProviderConfig.test.js` (CREATE)
- **Purpose**: Regression test for provider config double-wrap fix
- **Imports**: `require('supertest')`, `require('../index')`, `AgentService`
- **Structure**: `describe('AgentService.getProviderConfig', ...)`, `describe('Route: GET /agents/:agentId/provider-config', ...)`

#### `backend/src/__tests__/agentListing.test.js` (CREATE)
- **Purpose**: Regression test for agent listing fix
- **Imports**: `HeartbeatService`, `pool` (from db mock)
- **Structure**: `describe('HeartbeatService.getAllAgents', ...)`

#### `backend/src/__tests__/corsValidation.test.js` (EXTEND)
- **Purpose**: Add 127.0.0.1 origin tests
- **Add**: Two new `it()` blocks for `127.0.0.1:3000` and `127.0.0.1:3002`

---

### d) Dependencies

- [Backend service]: `AgentService.getProviderConfig()` — returns provider config for Java agent
- [Backend service]: `HeartbeatService.getAllAgents()` — returns all agents with status
- [Backend middleware]: `cors.js` — strict origin allowlist
- [Existing test patterns]: Follow existing Jest test structure in `backend/src/__tests__/`

---

### e) Risks/Edge Cases

- **[Risk] Java agent expects double-wrapped response**: The Java agent's `ApiService.getProviderConfig()` may have been written to parse the double-wrapped response. **Mitigation**: Fix backend to correct behavior. Add defensive parsing in future agent ticket. The double-wrap is a bug, not a feature.
- **[Risk] `GROUP BY` change affects existing tests**: Tests that mock `getAllAgents()` may assume the old SQL structure. **Mitigation**: Update affected tests.
- **[Edge case] Agent with heartbeat but deleted from agents table**: LEFT JOIN handles this — agent appears with null heartbeat fields (existing behavior, unchanged).
- **[Edge case] Agent with no heartbeat**: Now appears with null heartbeat fields (the fix).
- **[Edge case] Empty origin header**: CORS middleware calls `next()` (existing behavior, unchanged).

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Test-First Requirement

Test stub files MUST be created before production code. The model MUST:
1. Create empty test stub files (with imports, `describe` blocks, and stub `it` blocks)
2. Create production code files
3. Fill in the test stubs with actual assertions

#### Backend Unit Tests

- [ ] Test file CREATED: `backend/src/__tests__/agentProviderConfig.test.js` — 7 test cases
- [ ] Test file CREATED: `backend/src/__tests__/agentListing.test.js` — 6 test cases
- [ ] Test file EXTENDED: `backend/src/__tests__/corsValidation.test.js` — 2 new test cases
- [ ] Every new service method has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] **Coverage threshold (60%)**: run `npm run test:coverage` — must pass 60% min on lines, functions, branches, statements

#### Backend Bash Integration Suite

- [ ] New suite file: `backend/integration-test/suites/agentConnectivity.test.sh` — CREATED
- [ ] Test function registered in `backend/integration-test/run.sh` `main()` function
- [ ] Suite covers: provider config single-wrap (200), agent listing includes all agents (200), CORS 127.0.0.1 (200)
- [ ] Suite runs cleanly: `cd backend && bash integration-test/run.sh --only`

#### Frontend Tests

- [ ] No frontend changes — existing tests should pass unchanged

#### CI Requirements

- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes (no frontend changes)
- [ ] `npm run build` — frontend build passes (no frontend changes)

---

### g) Migration Notes (if applicable)

None. No database changes needed.

---

### h) Files Changed

**Backend:**
```
docker-compose.yml                    → MODIFY (ALLOWED_ORIGINS default)
backend/src/services/AgentService.js  → MODIFY (remove double-wrap)
backend/src/services/HeartbeatService.js → MODIFY (swap FROM/JOIN)
backend/src/__tests__/agentProviderConfig.test.js → CREATE (7 tests)
backend/src/__tests__/agentListing.test.js → CREATE (6 tests)
backend/src/__tests__/corsValidation.test.js → EXTEND (2 new tests)
```

**Frontend:**
```
(none — no frontend changes)
```

---

### Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-120 | Defensive Java agent parsing for double-wrapped responses during transition | Java Agent | Future agent ticket | ☐ |

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (service methods, test structure)
- [ ] Backend uses parameterized queries (no SQL injection) — existing queries already parameterized
- [ ] Backend response format: `{ success: true, data: { ... } }` — provider config now correctly single-wrapped
- [ ] Backend errors pass to `next(error)` — unchanged
- [ ] Frontend API client uses existing patterns — N/A (no frontend changes)
- [ ] Frontend UI follows existing patterns — N/A (no frontend changes)
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed — N/A (no route changes)
- [ ] Generated TypeScript types regenerated if response shapes changed — N/A
- [ ] Generated types compile: `npm run typecheck` — N/A
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes — N/A
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields — N/A
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes
3. [ ] **Backend: `cd backend && bash integration-test/run.sh --only` passes**
4. [ ] Backend: `npm run lint` passes
5. [ ] **Backend: `npm run test:coverage` passes (60% min threshold)**
6. [ ] Frontend: `npm run lint` passes
7. [ ] Frontend: `npm run typecheck` passes
8. [ ] Frontend: `npm run build` passes
9. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
10. [ ] Provider config endpoint returns single-wrapped response: `curl -H "X-API-Key: <key>" http://localhost:3001/api/v1/agents/<id>/provider-config`
11. [ ] Agent listing includes all agents: `curl -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/agents-status`
12. [ ] CORS allows 127.0.0.1: `curl -H "Origin: http://127.0.0.1:3000" http://localhost:3001/api/health`
13. [ ] Auth/permissions work correctly
14. [ ] Error cases handled gracefully
