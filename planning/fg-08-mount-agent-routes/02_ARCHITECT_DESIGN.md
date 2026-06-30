# 02_ARCHITECT_DESIGN.md — Mount Agent Heartbeat Routes

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The agent heartbeat routes were implemented in `backend/src/api/v1/agentHeartbeat.js` but never connected to the Express application. All agent status endpoints return 404 errors. The frontend agent list and detail pages, which poll these endpoints every 10 seconds, are completely broken. Additionally, the existing code uses anti-patterns (console.error instead of logger, no next(err) delegation) that must be fixed.

---

## Current State

### Existing Backend
- `backend/src/api/v1/agentHeartbeat.js` — Route file exists (created by PR 4/5) with 3 endpoints
- `backend/src/api/v1/index.js` — Does NOT require or mount agentHeartbeat
- `backend/src/services/HeartbeatService.js` — Service exists and is functional
- `backend/src/utils/shutdown.js` — Already has cleanupHooks support

### Existing Frontend
- `frontend/src/api/agents.js` — Correctly calls `/api/v1/agents-status` and `/api/v1/agents-status/:id`
- `frontend/src/views/AgentList.vue` — Polls `/api/v1/agents-status` every 10s
- `frontend/src/views/AgentDetail.vue` — Fetches `/api/v1/agents-status/:id`

### Gap Analysis
- Backend routes exist but are not wired up — they're dead code
- Frontend correctly targets `/api/v1/agents-status/*` — needs the backend to respond
- Route handlers lack `next(error)` pattern used everywhere else in the project
- Route handlers use `console.error` instead of winston logger

---

## Design

### Option A: Mount in v1/index.js (Recommended)

Add to `backend/src/api/v1/index.js`:

```javascript
const agentHeartbeatRouter = require('./agentHeartbeat');
// ...
router.use('/agents-status', agentHeartbeatRouter);
```

This is consistent with how all other v1 routes are mounted (`router.use('/agents', agentsRouter)`).

### Option B: Mount in routes.js

Mount as an unversioned route in `backend/src/api/routes.js`. Not recommended because all other API routes are versioned at `/api/v1/`.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/api/v1/agentHeartbeat.js` | MODIFY | Add `next` param to all handlers, replace console.error with logger, add JSDoc |
| `backend/src/api/v1/index.js` | MODIFY | Add `require('./agentHeartbeat')` and `router.use('/agents-status', agentHeartbeatRouter)` |

---

## Data Flow Diagram

```
[Java Agent/Frontend UI] → [GET/POST /api/v1/agents-status/*] → [verifyToken or X-API-Key] → [HeartbeatService] → [agent_heartbeats table]
```

### Backend Data Flow
1. HTTP request arrives at `POST /api/v1/agents-status/:id/heartbeat`
2. Agent provides X-API-Key header → AgentService.getAgentByApiKey validates
3. HeartbeatService.recordHeartbeat upserts the heartbeat row
4. Response: `{ success: true }`
5. Errors pass to `next(error)` → global error handler → `{ success: false, error: { code, message } }`

### Error Handling Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| Auth | Missing X-API-Key | 401, `{ success: false, error: { code: 'UNAUTHORIZED', message: '...' }` |
| Auth | Invalid API key | 403, `{ success: false, error: { code: 'FORBIDDEN', message: '...' }` |
| Route handler | Unexpected error | Pass `next(error)` → 500, `{ success: false, error: { code: 'INTERNAL_ERROR', message }` |

---

## Dependencies

### Backend Dependencies
- `backend/src/services/HeartbeatService.js` — Record and query heartbeats
- `backend/src/services/AgentService.js` — Validate agent API keys

---

## Config / Environment Changes

- [ ] No new environment variables

---

## Security Considerations

- [x] POST `/agents-status/:id/heartbeat` requires X-API-Key header matching the agent ID
- [x] GET `/agents-status` and GET `/agents-status/:id` require verifyToken
- [ ] Joi validation on heartbeat POST body: MINOR — not strictly needed since only trusted agents call this

---

## Risks and Edge Cases

### Backend Risks
- **[Mount path mismatch]**: The route JSDoc comments say `/api/v1/agents` but actual mount is `/api/v1/agents-status`. The mount path MUST match what the Java agent sends (`/agents-status/{id}/heartbeat`) and what the frontend calls (`/api/v1/agents-status`).

### Edge Cases
- **Agent sends heartbeat before being registered**: HeartbeatService will no-op or fail; handled by the 403 check in the route.

---

## Alternative Designs Considered

### Alternative 1: Keep inline error handling
- **Cons**: Violates project pattern, loses centralized error handling
- **Decision**: Switch to `next(error)` like all other route files
