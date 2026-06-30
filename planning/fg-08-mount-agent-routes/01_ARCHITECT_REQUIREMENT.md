# 01_ARCHITECT_REQUIREMENT.md — Mount Agent Heartbeat Routes

**Status**: planned
**Date created**: 2026-06-29
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P0
**Effort**: Small

---

## Requirement

The `backend/src/api/v1/agentHeartbeat.js` route module was created during PR 4 (bp-33) but was never required or mounted in either `backend/src/api/v1/index.js` or `backend/src/api/routes.js`. All agent heartbeat API endpoints return 404, making the entire agent liveness/status feature non-functional. Additionally, the existing route handlers lack the `next` parameter and use `console.error` instead of the project's winston logger.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] API route exists: `backend/src/api/v1/agentHeartbeat.js` — YES (created but NOT mounted)
- [x] Route is mounted: `backend/src/api/v1/index.js` — NO (missing require + router.use)
- [x] OpenAPI JSDoc annotations: NO
- [x] Error handler uses `next(error)`: NO (uses inline catch + res.status(500))
- [x] Logger uses winston: NO (uses console.error)
- [x] Service exists: `backend/src/services/HeartbeatService.js` — YES

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/agents.js` — YES (calls `/api/v1/agents-status` which will 404 until fixed)

### Integration Check
- [x] Frontend calls: GET `/api/v1/agents-status`, GET `/api/v1/agents-status/:id` — YES
- [x] Backend route will be at: GET `/api/v1/agents-status/`, GET `/api/v1/agents-status/:id` — must match
- [x] Agent Java code POSTs to: `/agents-status/{agentId}/heartbeat` — must match

### Key Insight
The backend route module exists but is a dead file. The backend must be modified to mount it. This is a BACKEND-ONLY fix, but the frontend cannot function until this is corrected.

---

## Scope

### In Scope
- Mount `agentHeartbeat` router in `backend/src/api/v1/index.js`
- Add `next(err)` parameter and call to all 3 route handlers
- Replace `console.error` with project's winston logger
- Add consistent JSDoc OpenAPI annotations
- Ensure agent-side auth (X-API-Key) is properly handled with error middleware

### Out of Scope
- Changes to frontend API client paths (they are already correct)
- Changes to the HeartbeatService itself
- Changes to Java agent code

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/v1/agentHeartbeat.js` | MODIFY | Add next param, replace console.error with logger, add JSDoc |
| `backend/src/api/v1/index.js` | MODIFY | Add `require('./agentHeartbeat')` + `router.use('/agents-status', agentHeartbeatRouter)` |

---

## Known Unknowns

1. **[Logger import path]**: Need to verify the exact logger module path used in the project — likely `require('../utils/logger')` or winston directly.

---

## Important Design Decisions

1. Mount path — Should be `/agents-status` (matching Java agent's heartbeat POST URL and frontend API client calls). The JSDoc comments currently say `/agents` but the actual paths must use `/agents-status`.

---

## Acceptance Criteria

1. [ ] [Backend] GET `/api/v1/agents-status` returns agent list instead of 404
2. [ ] [Backend] GET `/api/v1/agents-status/:id` returns agent detail instead of 404
3. [ ] [Backend] POST `/api/v1/agents-status/:id/heartbeat` returns 200 instead of 404
4. [ ] [Backend] All route handlers accept `(req, res, next)` signature
5. [ ] [Backend] All route handlers pass errors to `next(error)`
6. [ ] [Backend] All route handlers use project's winston logger, not console.error
7. [ ] [Backend] JSDoc annotations exist for all 3 endpoints
8. [ ] [Backend] `npm test` passes
9. [ ] [Backend] `npm run lint` passes

---

## Security Considerations

- [x] Authentication required: YES — X-API-Key for heartbeat POST, verifyToken for GET endpoints
- [x] Authorization check: YES — agent API key must match agent ID
- [ ] Rate limiting: NO
- [ ] Sensitive data handling: NO

---

## Testing Checklist

### Backend Tests
- [ ] Existing tests in `backend/src/__tests__/heartbeatService.test.js` still pass
- [ ] New integration test: POST to `/api/v1/agents-status/:id/heartbeat` with valid X-API-Key returns 200
- [ ] New integration test: GET `/api/v1/agents-status` with valid token returns 200

### CI Requirements
- [ ] `npm test` passes
- [ ] `npm run lint` passes
