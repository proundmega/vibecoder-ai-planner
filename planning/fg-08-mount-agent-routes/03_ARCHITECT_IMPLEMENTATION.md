# 03_ARCHITECT_IMPLEMENTATION.md — Mount Agent Heartbeat Routes

---

## Ticket: fg-08 — Mount agent heartbeat routes

**Status**: planned
**Priority**: P0
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-29
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

The agent heartbeat routes (`agentHeartbeat.js`) were created during PR 4 (bp-33) but never mounted in the Express app. All agent status endpoints return 404, breaking the entire agent liveness feature. Additionally, the route handlers use anti-patterns (console.error, no next(error)) that must be fixed.

---

### b) Actions

#### Implementation Order

1. **Add logger import** — `backend/src/api/v1/agentHeartbeat.js`
   - Add `const logger = require('../utils/logger');` (or the actual logger path used by the project — check `backend/src/index.js` or other route files for the pattern)
   - *Depends on*: nothing

2. **Fix route handlers** — `backend/src/api/v1/agentHeartbeat.js`
   - Change all 3 handlers from `async (req, res)` to `async (req, res, next)`
   - Replace all `console.error('...', error)` with `logger.error('...', error)`
   - Replace inline catch blocks with `next(error)` calls
   - Add JSDoc OpenAPI annotations for all 3 endpoints

3. **Mount routes** — `backend/src/api/v1/index.js`
   - Add `const agentHeartbeatRouter = require('./agentHeartbeat');`
   - Add `router.use('/agents-status', agentHeartbeatRouter);`
   - Place after the `router.use('/tickets', phaseRouter);` line, following the existing pattern

---

### c) Per-File Action Plan

#### `backend/src/api/v1/agentHeartbeat.js` (MODIFY)

**Import changes:**
- Add: `const logger = require('../utils/logger');` (verify exact path from existing code)

**Route handler changes (all 3 handlers):**

POST `/:id/heartbeat`:
```javascript
router.post('/:id/heartbeat', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'X-API-Key header required' } });
    }
    const agent = await AgentService.getAgentByApiKey(apiKey);
    if (!agent || agent.id !== Number(req.params.id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Invalid API key for this agent' } });
    }
    const { current_ticket_id, current_step, memory_usage, cpu_usage } = req.body;
    await HeartbeatService.recordHeartbeat(agent.id, {
      ticketId: current_ticket_id, step: current_step, memory: memory_usage, cpu: cpu_usage,
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('POST /agents/:id/heartbeat failed:', error);
    next(error);
  }
});
```

GET `/`:
```javascript
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const agents = await HeartbeatService.getAllAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    logger.error('GET /agents failed:', error);
    next(error);
  }
});
```

GET `/:id`:
```javascript
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const agent = await HeartbeatService.getAgentStatus(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    // ... rest of handler
  } catch (error) {
    logger.error('GET /agents/:id failed:', error);
    next(error);
  }
});
```

**Add JSDoc annotations for all 3 endpoints** following the pattern from `backend/src/api/tickets.js`.

#### `backend/src/api/v1/index.js` (MODIFY)

```javascript
// After other router requires
const agentHeartbeatRouter = require('./agentHeartbeat');

// After other router.use lines, add:
router.use('/agents-status', agentHeartbeatRouter);
```

---

### d) Dependencies

- No new dependencies. Uses existing logger and service imports.

---

### e) Risks/Edge Cases

- **[Mount path mismatch]**: Ensure the mount path `/agents-status` matches the Java agent's POST URL (`/agents-status/{agentId}/heartbeat`) and the frontend's GET calls (`/api/v1/agents-status`). The JSDoc comments in the original file say `/api/v1/agents` — these must be updated to `/agents-status`.

---

### f) Testing

#### Backend Unit Tests
- [ ] Existing `heartbeatService.test.js` passes (no changes expected to service tests)
- [ ] New route-level test: `backend/src/__tests__/api-agentHeartbeat.test.js`

#### CI Requirements
- [ ] `npm test` passes
- [ ] `npm run lint` passes

---

### g) Files Changed

**Backend:**
```
backend/src/api/v1/agentHeartbeat.js   → MODIFY (add next, logger, JSDoc)
backend/src/api/v1/index.js            → MODIFY (require + mount)
```

---

### h) Code Review Checklist

- [x] Route handlers use `(req, res, next)` and `next(error)`
- [x] Route handlers use winston logger, not console.error
- [x] Route is mounted at `/agents-status` matching frontend and Java agent expectations
- [x] JSDoc annotations exist for all endpoints
- [x] Response format: `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`
- [x] All tests pass
- [x] No lint errors
