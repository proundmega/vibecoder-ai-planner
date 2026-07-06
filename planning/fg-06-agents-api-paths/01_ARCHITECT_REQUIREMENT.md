# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: 2026-06-19
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P0
**Effort**: Small

---

## Requirement

Fix the agents API client's broken endpoint paths. The frontend sends requests with duplicated `agents/agents` path segments and wrong base paths. The backend routes are mounted at `/api/agents/` (not `/api/v1/agents/`).

**Current behavior**: All agent API calls fail with 404 errors. The agents feature is completely broken.
**Expected behavior**: Agent API calls reach the correct backend endpoints.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/agents.js` — YES
- [x] Controller logic in: `backend/src/api/agents.js` (routes defined inline)
- [x] Service exists: `backend/src/services/AgentService.js` — YES
- [x] Route is mounted: `backend/src/api/v1/index.js:29` — YES (`router.use('/agents', agentsRouter)`)
- [ ] Routes are under `/api/v1/agents/` — YES (mounted under `/v1`)
- [x] OpenAPI JSDoc annotations exist — YES

**Actual backend routes**:
| Method | Backend Path | Description |
|--------|-------------|-------------|
| POST | `/api/v1/agents/create` | Create agent |
| GET | `/api/v1/agents/` | List agents |
| POST | `/api/v1/agents/revoke/:agentId` | Revoke API key |
| DELETE | `/api/v1/agents/:agentId` | Delete agent |
| GET | `/api/v1/agents/:agentId/history` | Agent history |
| GET | `/api/v1/agents/:agentId/key` | Agent key info |

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/agents.js` — YES
- [ ] API client functions cover all needed endpoints — NO (all paths are wrong)
- [x] API client follows existing patterns — YES (uses `get`, `post`, `postWithHeaders`)

**Current (broken) frontend paths**:
| Function | Frontend Path | Backend Path |
|----------|--------------|--------------|
| `createTicket` | `/api/v1/agents/tickets/create` | (none) |
| `updateTicket` | `/api/v1/agents/agents/tickets/edit/:id` | (none) |
| `claimTicket` | `/api/v1/agents/agents/tickets/claim/:id` | (none) |
| `changeTicketStatus` | `/api/v1/agents/agents/tickets/status/:id` | (none) |
| `getAgentTickets` | `/api/v1/agents/agents/tickets/my-tasks/:id` | (none) |
| `getAgentKeyInfo` | `/api/v1/agents/agents/:agentId/key` | `/api/v1/agents/:agentId/key` |
| `createAgent` | `/api/v1/agents/agents/create` | `/api/v1/agents/create` |
| `listAgents` | `/api/v1/agents/agents` | `/api/v1/agents/` |
| `getAgentHistory` | `/api/v1/agents/agents/:agentId/history` | `/api/v1/agents/:agentId/history` |

### Frontend UI Check
- [x] View component exists: `frontend/src/views/AIAssistant.vue` — YES (uses agents partially)
- [ ] Route exists: `frontend/src/router/index.ts` — YES (AIAssistant route exists)

### Integration Check
- [ ] Frontend API client can call existing backend endpoints — NO (all paths wrong)
- [x] Response shapes match — unknown (calls never succeed)
- [x] Auth tokens are used correctly — YES (uses `x-api-key` header for agent calls)
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **FRONTEND-ONLY fix**. The backend routes are correct and mounted at `/api/v1/agents/`. The frontend API client has two issues:

1. **Duplicated path segment**: `agents/agents` should be just `agents` (e.g., `/api/v1/agents/agents/create` → `/api/v1/agents/create`)
2. **Non-existent ticket endpoints**: The ticket CRUD endpoints (`/tickets/create`, `/tickets/edit/:id`, etc.) don't exist in the agents router — they exist in the tickets router at `/api/v1/tickets/`

---

## Scope

### In Scope
- [ ] Fix `frontend/src/api/agents.js` — correct all endpoint paths to match backend
- [ ] Remove or fix the non-existent ticket endpoints (they don't exist in the agents router)
- [ ] Verify the existing agent endpoints (`createAgent`, `listAgents`, `getAgentKeyInfo`, `getAgentHistory`) work correctly

### Out of Scope
- Creating new ticket endpoints in the agents router
- Backend changes to agents routes
- New UI components

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/api/agents.js` | MODIFY | Fix all endpoint paths, remove dead ticket functions |
| `frontend/src/views/AIAssistant.vue` | VERIFY | Check for usages of removed ticket functions |
| `database` | NONE | No schema changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Exact line numbers]**: The agents API client line numbers may have shifted. **Resolution**: Read `frontend/src/api/agents.js` to find actual function locations.
2. **[UI usages]**: `AIAssistant.vue` or other components may use the removed ticket functions. **Resolution**: grep for all usages before removing.

---

## Important Design Decisions

**DECISION POINTS**:

1. **What to do with the ticket endpoints?** The frontend calls `/api/v1/agents/tickets/create`, `/api/v1/agents/agents/tickets/edit/:id`, etc. but these don't exist in the agents router. Options:
   - A) Remove these functions entirely (they're not used by any UI)
   - B) Redirect them to the correct tickets endpoints (`/api/v1/tickets/`)
   - C) Create the missing endpoints in the agents router
   
   **Recommendation**: Option A — remove the ticket functions. They use `postWithHeaders` (agent API key auth) which is wrong for ticket operations. The tickets API uses token auth. These functions are likely leftover from an old design.

---

## Acceptance Criteria

1. [ ] [Frontend API] `createAgent()` calls `POST /api/v1/agents/create`
2. [ ] [Frontend API] `listAgents()` calls `GET /api/v1/agents/`
3. [ ] [Frontend API] `getAgentKeyInfo()` calls `GET /api/v1/agents/:agentId/key`
4. [ ] [Frontend API] `getAgentHistory()` calls `GET /api/v1/agents/:agentId/history`
5. [ ] [Frontend API] Ticket-related functions removed (they don't exist in backend)
6. [ ] [Frontend UI] AIAssistant.vue agent operations work (if it uses agents API)
7. [ ] [Both] All tests pass
8. [ ] [Both] Linting passes
9. [ ] [Both] Frontend typecheck passes

---

## Out of Scope

- Creating ticket endpoints in the agents router
- Backend changes to agents routes
- New UI components for agent management
- Adding new agent endpoints

---

## Performance Considerations

- Expected load: N/A — this is a path fix, no new queries or computations
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A

---

## Security Considerations

- Authentication required: YES (existing — agents endpoints require auth)
- Authorization check: YES (existing — project-level access control)
- Input validation: YES (existing — Joi schemas in agents router)
- Rate limiting: N/A (agents are admin-managed, not user-facing)
- Sensitive data handling: API keys are returned in agent responses — existing behavior unchanged

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `npm test -- --run` — no regressions
- [ ] Manual verification: Create agent, list agents, verify API calls succeed

### Frontend Contract Tests
- [ ] `frontend/src/__tests__/api-contract.test.ts` — verify agent response shapes (createAgent, listAgents, getAgentKeyInfo, getAgentHistory)
- [ ] `frontend/src/api/validator.ts` — verify agent response schemas match backend

### CI Requirements
- [ ] `npm run lint` — frontend lint passes
- [ ] `npm run typecheck` — frontend typecheck passes

---

## Anti-Patterns to Avoid

- ❌ **Adding ticket endpoints to the agents router** — tickets have their own router
- ❌ **Changing the backend** — backend routes are correct
- ❌ **Keeping dead code** — remove the non-existent ticket functions
