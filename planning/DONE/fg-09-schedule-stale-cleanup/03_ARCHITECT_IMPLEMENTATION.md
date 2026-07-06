# 03_ARCHITECT_IMPLEMENTATION.md — Schedule Stale Agent Cleanup

---

## Ticket: fg-09 — Schedule stale agent cleanup

**Status**: planned
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-29
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Add a periodic scheduler to call `HeartbeatService.cleanupStaleAgents()` every 60 seconds so that crashed/disconnected agents are automatically marked offline and their tickets are released.

---

### b) Actions

#### Implementation Order

1. **Add cleanup scheduler** — `backend/src/index.js`
   - Add `const HeartbeatService = require('./services/HeartbeatService');`
   - Add after server start:
     ```javascript
     const cleanupInterval = setInterval(() => {
       HeartbeatService.cleanupStaleAgents().catch(err => {
         logger.error('Stale agent cleanup failed:', err.message);
       });
     }, 60000);
     ```
   - Pass cleanup to shutdown hooks:
     ```javascript
     gracefulShutdown(server, pool, [() => clearInterval(cleanupInterval)]);
     ```

---

### c) Per-File Action Plan

#### `backend/src/index.js` (MODIFY)

**Add import** (verify current imports):
```javascript
const HeartbeatService = require('./services/HeartbeatService');
```

**Add after server.listen() or server start** (before gracefulShutdown):
```javascript
const cleanupInterval = setInterval(() => {
  HeartbeatService.cleanupStaleAgents().catch(err => {
    logger.error('Stale agent cleanup failed:', err.message);
  });
}, 60000);
```

**Modify gracefulShutdown call** to pass cleanup:
```javascript
gracefulShutdown(server, pool, [() => clearInterval(cleanupInterval)]);
```

---

### d) Dependencies

- `backend/src/services/HeartbeatService.js`
- `backend/src/utils/shutdown.js` (already supports cleanupHooks)

---

### e) Risks/Edge Cases

- **[Startup race]**: If cleanup runs before the server is fully started, it's harmless (no agents to cleanup yet)
- **[Error handling]**: `.catch()` on the promise prevents unhandled rejections from crashing the process

---

### f) Testing

#### Backend Unit Tests
- [ ] No new tests needed — `heartbeatService.test.js` already covers the cleanup logic
- [ ] Manual verification: start server, wait 60s, verify stale agents are marked offline

#### CI Requirements
- [ ] `npm test` passes
- [ ] `npm run lint` passes

---

### g) Files Changed

**Backend:**
```
backend/src/index.js   → MODIFY (add import + setInterval + shutdown hook)
```
