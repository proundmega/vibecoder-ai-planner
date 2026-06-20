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

Fix the agents API client's broken endpoint paths. The frontend has duplicated `agents/agents` path segments and calls non-existent ticket endpoints, making the entire agents feature non-functional.

---

### b) Actions

**Backend API already exists — no changes needed.**

#### Phase 1: Frontend API Client

1. Fix `frontend/src/api/agents.js`:

   **Remove these functions** (they call non-existent endpoints):
   - `createTicket()` — calls `/api/v1/agents/tickets/create` (doesn't exist)
   - `updateTicket()` — calls `/api/v1/agents/agents/tickets/edit/:id` (doesn't exist)
   - `claimTicket()` — calls `/api/v1/agents/agents/tickets/claim/:id` (doesn't exist)
   - `changeTicketStatus()` — calls `/api/v1/agents/agents/tickets/status/:id` (doesn't exist)
   - `getAgentTickets()` — calls `/api/v1/agents/agents/tickets/my-tasks/:id` (doesn't exist)

   **Fix these functions** (remove duplicated `agents/` segment):
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

2. Check `frontend/src/views/AIAssistant.vue` for usages of removed functions:
   ```bash
   grep -n "createTicket\|updateTicket\|claimTicket\|changeTicketStatus\|getAgentTickets" frontend/src/views/AIAssistant.vue
   ```
   If any are found, remove or replace them.

#### Phase 2: Testing

3. Run frontend tests: `cd frontend && npm test -- --run`
4. Run frontend lint: `cd frontend && npm run lint`
5. Run frontend typecheck: `cd frontend && npm run typecheck`
6. Manual test: Use the agents feature (if any UI uses it), verify API calls succeed

---

### c) Dependencies

- None — frontend-only fix

---

### d) Risks/Edge Cases

- **[Risk]**: `AIAssistant.vue` or other components use removed ticket functions
  **[Mitigation]**: grep for all usages before removing

---

### e) Testing

#### Frontend Unit Tests
- [ ] `npm test -- --run` — no regressions

#### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

### f) Migration Notes

Not applicable — no database changes.

---

### g) Files Changed

**Frontend:**
```
frontend/src/api/agents.js        → fix paths, remove dead ticket functions
frontend/src/views/AIAssistant.vue → remove usages of deleted functions (if any)
```

---

### h) Code Review Checklist

- [ ] All agent endpoint paths are correct (no duplicated `agents/agents`)
- [ ] Dead ticket functions removed
- [ ] No usages of removed functions remain
- [ ] All tests pass
- [ ] No backend changes needed

---

### i) Post-Deploy Verification

1. [ ] `cd frontend && npm test -- --run` passes
2. [ ] `cd frontend && npm run lint` passes
3. [ ] `cd frontend && npm run typecheck` passes
4. [ ] Verify no 404 errors in browser console for agent API calls
