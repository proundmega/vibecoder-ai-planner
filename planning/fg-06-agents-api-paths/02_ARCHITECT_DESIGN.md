# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The agents API client (`frontend/src/api/agents.js`) has broken endpoint paths. All paths have a duplicated `agents/agents` segment (e.g., `/api/v1/agents/agents/create` instead of `/api/v1/agents/create`). Additionally, ticket-related functions call endpoints that don't exist in the agents router. This makes the entire agents feature non-functional.

---

## Current State

### Existing Backend
- **Route module**: `backend/src/api/agents.js` — Express router with 6 routes
- **Mounted at**: `backend/src/api/v1/index.js:29` → `router.use('/agents', agentsRouter)`
- **Full paths**:
  - `POST /api/v1/agents/create` — create agent
  - `GET /api/v1/agents/` — list agents
  - `POST /api/v1/agents/revoke/:agentId` — revoke API key
  - `DELETE /api/v1/agents/:agentId` — delete agent
  - `GET /api/v1/agents/:agentId/history` — agent activity history
  - `GET /api/v1/agents/:agentId/key` — agent key info

### Existing Frontend
- **API Client**: `frontend/src/api/agents.js` — 9 functions, all with wrong paths
- **Broken paths**:
  ```
  /api/v1/agents/tickets/create          → doesn't exist
  /api/v1/agents/agents/tickets/edit/:id → doesn't exist
  /api/v1/agents/agents/tickets/claim/:id → doesn't exist
  /api/v1/agents/agents/tickets/status/:id → doesn't exist
  /api/v1/agents/agents/tickets/my-tasks/:id → doesn't exist
  /api/v1/agents/agents/:agentId/key     → should be /api/v1/agents/:agentId/key
  /api/v1/agents/agents/create           → should be /api/v1/agents/create
  /api/v1/agents/agents                  → should be /api/v1/agents/
  /api/v1/agents/agents/:agentId/history → should be /api/v1/agents/:agentId/history
  ```

### Gap Analysis
- Backend routes are correct
- Frontend paths have duplicated `agents/agents` segment
- Ticket-related functions call non-existent endpoints
- 4 out of 9 functions have fixable path issues
- 5 out of 9 functions call endpoints that don't exist (ticket operations)

---

## Design

### Option A: Fix Paths and Remove Dead Code (Recommended)

**Changes in `frontend/src/api/agents.js`:**

```javascript
import { get, post, postWithHeaders } from './client'

// REMOVE: createTicket, updateTicket, claimTicket, changeTicketStatus, getAgentTickets
// These call endpoints that don't exist in the agents router.
// Ticket operations belong in the tickets API (/api/v1/tickets/), not the agents API.

export function getAgentKeyInfo(agentId) {
  return get(`/api/v1/agents/${agentId}/key`)
}

export function createAgent(name) {
  return post('/api/v1/agents/create', { name })
}

export function listAgents() {
  return get('/api/v1/agents/')
}

export function getAgentHistory(agentId, apiKey = null) {
  const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
  return get(`/api/v1/agents/${agentId}/history`, options)
}
```

**Why this is the right choice**: Fixes the working endpoints by removing the duplicated `agents/` segment. Removes dead code (ticket functions that call non-existent endpoints).

### Option B: Create Missing Ticket Endpoints in Agents Router

Add the ticket CRUD endpoints to `backend/src/api/agents.js`.

**Pros**: Would make all frontend functions work.
**Cons**: The ticket endpoints belong in the tickets router, not the agents router. Agents should use the tickets API like any other client.
**Decision**: Option A is cleaner — remove dead code, don't create endpoints for dead code.

### Option C: Redirect Ticket Functions to Tickets API

Change the ticket functions to call `/api/v1/tickets/` instead of `/api/v1/agents/`.

**Pros**: Preserves the ticket functions.
**Cons**: The functions use `postWithHeaders` with `x-api-key` (agent auth), but ticket operations use token auth. Mixing auth patterns is confusing.
**Decision**: Option A is simpler — remove the functions entirely.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/api/agents.js` | MODIFY | Fix all endpoint paths (remove duplicated `agents/` segment), remove 5 dead ticket functions |
| `frontend/src/views/AIAssistant.vue` | VERIFY | Check for usages of removed ticket functions |

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/agents.test.js` | API client functions call correct endpoints |
| Frontend contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Response shapes match backend |
| Frontend component | Cypress | `frontend/cypress/component/` | Agent operations work with correct paths |
| Frontend E2E | Cypress | `frontend/cypress/e2e/` | Full agent creation/list flow |

### Frontend-Backend Contract Testing

- Response schemas in `frontend/src/api/validator.ts` must include agent response fields: `id`, `name`, `user_id`, `api_key`, `generatedApiKey`
- If the contract test has an agent shape assertion, verify it matches the backend's actual response
- Generated TypeScript types from OpenAPI spec should include the agent response — verify by running `npm run generate:spec && npm run generate:api && npm run typecheck`

---

## Security Considerations

- No new endpoints — existing auth/authorization applies unchanged
- No new data exposure — path fix does not change what data is returned
- No input changes — this is purely a path correction

---

## Data Flow Diagram

```
[Frontend] → createAgent('My Agent')
  → POST /api/v1/agents/create { name: 'My Agent' }
  → [Backend agents router]
  → [AgentService.create()]
  → [Database: INSERT INTO agents]
  → [Response: { id, name, user_id, api_key, generatedApiKey }]
```

---

## Dependencies

### Backend Dependencies
- None — backend routes are correct

### Frontend Dependencies
- `frontend/src/api/agents.js` — fix paths, remove dead code
- `frontend/src/views/AIAssistant.vue` — check if it uses any of the removed functions

### Cross-Cutting Dependencies
- None

---

## Config / Environment Changes

- No env var changes
- No database migrations
- No npm dependency changes

---

## Risks and Edge Cases

### Frontend Risks
- **[Risk]**: `AIAssistant.vue` might use one of the removed ticket functions
  **[Mitigation]**: Check all usages of `createTicket`, `updateTicket`, etc. before removing

### Integration Risks
- None

### Edge Cases
- If any external code calls these functions, they'll break (unlikely — only frontend uses this API client)

---

## Alternative Designs Considered

### Alternative 1: Create missing ticket endpoints in backend
- **Pros**: All frontend functions work
- **Cons**: Wrong architectural pattern — tickets belong in tickets router
- **Decision**: Option A is cleaner

### Alternative 2: Redirect ticket functions to tickets API
- **Pros**: Preserves ticket functions
- **Cons**: Mixes auth patterns (agent key vs. token)
- **Decision**: Option A is simpler

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file (if a small model will execute this ticket)

---

*This design document guides implementation. The fix is correcting path segments and removing dead code.*
