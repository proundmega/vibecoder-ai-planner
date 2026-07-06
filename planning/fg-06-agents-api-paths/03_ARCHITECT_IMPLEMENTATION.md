# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-06 — Fix agents API client broken endpoint paths

**Status**: planned | in_progress | completed | blocked
**Priority**: P0
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Fix the agents API client's broken endpoint paths. The frontend has duplicated `agents/agents` path segments and calls non-existent ticket endpoints, making the entire agents feature non-functional (all calls return 404).

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Check for usages of removed functions]** — `frontend/src/`
   - Run `grep -rn "createTicket\|updateTicket\|claimTicket\|changeTicketStatus\|getAgentTickets" frontend/src/`
   - Document any usages found (will need to be removed or replaced)
   - *Depends on*: nothing

2. **[Fix agents API client]** — `frontend/src/api/agents.js`
   - Remove 5 dead ticket functions: `createTicket`, `updateTicket`, `claimTicket`, `changeTicketStatus`, `getAgentTickets`
   - Fix 4 agent functions: remove duplicated `agents/` segment from paths
   - *Depends on*: Step 1

3. **[Remove usages in UI]** — `frontend/src/views/AIAssistant.vue` (if usages found)
   - Remove or replace any calls to the deleted ticket functions
   - *Depends on*: Steps 1, 2

4. **[Run verification]** — `cd frontend`
   - `npm test -- --run` — no regressions
   - `npm run lint` — no lint errors
   - `npm run typecheck` — no TS errors
   - *Depends on*: Steps 1, 2, 3

---

### c) Per-File Action Plan

#### `frontend/src/api/agents.js` (MODIFY)
- **Change**: Fix all endpoint paths, remove dead ticket functions
- **Position**: Entire file
- **Functions to REMOVE**:
  ```javascript
  // REMOVE these 5 functions entirely:
  export function createTicket(...) { ... }
  export function updateTicket(...) { ... }
  export function claimTicket(...) { ... }
  export function changeTicketStatus(...) { ... }
  export function getAgentTickets(...) { ... }
  ```
- **Functions to FIX** (remove duplicated `agents/` segment):
  ```javascript
  // Before:
  export function getAgentKeyInfo(agentId) {
    return get(`/api/v1/agents/agents/${agentId}/key`)
  }
  // After:
  export function getAgentKeyInfo(agentId) {
    return get(`/api/v1/agents/${agentId}/key`)
  }

  // Before:
  export function createAgent(name) {
    return post('/api/v1/agents/agents/create', { name })
  }
  // After:
  export function createAgent(name) {
    return post('/api/v1/agents/create', { name })
  }

  // Before:
  export function listAgents() {
    return get('/api/v1/agents/agents')
  }
  // After:
  export function listAgents() {
    return get('/api/v1/agents/')
  }

  // Before:
  export function getAgentHistory(agentId, apiKey = null) {
    const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
    return get(`/api/v1/agents/agents/${agentId}/history`, options)
  }
  // After:
  export function getAgentHistory(agentId, apiKey = null) {
    const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
    return get(`/api/v1/agents/${agentId}/history`, options)
  }
  ```
- **Imports needed**: None (existing imports `get`, `post`, `postWithHeaders` from `./client` unchanged)

#### `frontend/src/views/AIAssistant.vue` (MODIFY or NONE)
- **Change**: Remove usages of deleted ticket functions (only if grep finds usages)
- **Position**: Wherever the functions are called
- **If no usages found**: No changes needed
- **Imports needed**: None (if removing function calls, may also remove unused imports)

---

### d) Dependencies

- None — this is a frontend-only fix, no backend changes, no new dependencies

---

### e) Risks/Edge Cases

- **[Risk]**: `AIAssistant.vue` or other components use the removed ticket functions
  **[Mitigation]**: Run `grep -rn "createTicket\|updateTicket\|claimTicket\|changeTicketStatus\|getAgentTickets" frontend/src/` before removing and handle all usages

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- No backend changes — existing tests should pass

#### Backend Jest Integration Tests
- N/A — no backend changes

#### Backend Bash Integration Suite
- N/A — no backend API changes

#### Frontend Unit Tests
- [ ] `npm test -- --run` — verify no regressions in `frontend/src/__tests__/agents.test.js`
- [ ] If `agents.test.js` exists: verify it tests the agent API client functions (createAgent, listAgents, getAgentKeyInfo, getAgentHistory)

#### Frontend E2E Tests
- [ ] Manual: Use the agents feature (if any UI uses it), verify API calls succeed (no 404 errors)

#### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify agent response shapes (createAgent, listAgents, getAgentKeyInfo, getAgentHistory)
- [ ] `frontend/src/api/validator.ts` — verify agent response schemas match backend

---

### g) Migration Notes

Not applicable — no database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/api/agents.js        → MODIFY: fix paths, remove 5 dead ticket functions
frontend/src/views/AIAssistant.vue → VERIFY/MODIFY: remove usages of deleted functions (if any)
```

---

### i) Code Review Checklist

- [ ] All agent endpoint paths are correct (no duplicated `agents/agents`)
- [ ] 5 dead ticket functions removed (`createTicket`, `updateTicket`, `claimTicket`, `changeTicketStatus`, `getAgentTickets`)
- [ ] No usages of removed functions remain in `AIAssistant.vue` or elsewhere
- [ ] No backend changes needed
- [ ] Frontend API client follows existing patterns (`get`, `post`, `put`, `del`, `patch` from `./client`)
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states (unchanged from before)
- [ ] All tests written and passing — existing tests still pass
- [ ] OpenAPI spec regenerated if backend routes changed (N/A — no backend changes)
- [ ] Generated TypeScript types regenerated if response shapes changed (N/A — no backend changes)
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes (N/A — no backend changes)
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers agent response shapes
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] `cd frontend && npm run build` passes
5. [ ] Verify no 404 errors in browser console for agent API calls
6. [ ] Verify no undefined function errors for removed ticket functions
7. [ ] If agents UI exists: create agent, list agents, verify operations work

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
