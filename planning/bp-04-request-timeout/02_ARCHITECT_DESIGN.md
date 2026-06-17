# 02_ARCHITECT_DESIGN.md — Request Timeout

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

No request timeout exists. Slow queries hang indefinitely, consuming connections and preventing the server from handling other requests.

---

## Current State

- No timeout middleware
- No slow request logging
- Database queries can hang if table is locked

---

## Design

### Timeout Middleware

```javascript
// backend/src/middleware/requestTimeout.js
function requestTimeout(timeoutMs = 30000) {
  return (req, res, next) => {
    req.setTimeout(timeoutMs, () => {
      res.status(408).json({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: `Request timed out after ${timeoutMs}ms`,
        },
      });
      req.destroy();
    });
    next();
  };
}
```

### Per-Endpoint Timeout Configuration

```javascript
// Routes with custom timeouts
const LONG_TIMEOUT = 60000; // 60 seconds

router.get('/billing/:id/billing', verifyToken, timeoutMiddleware(LONG_TIMEOUT), billingController.getProjectBilling);
router.get('/users/me/usage', verifyToken, timeoutMiddleware(LONG_TIMEOUT), usageController.getUserUsage);
```

### Slow Request Logging

```javascript
// backend/src/middleware/slowRequest.js
function slowRequestLogger(thresholdMs = 5000) {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > thresholdMs) {
        logger.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms`);
      }
    });
    next();
  };
}
```

### Alternative Designs Considered

- **Express `req.setTimeout` vs `server.setTimeout`** — Chose `req.setTimeout` over `server.setTimeout` because: it provides per-request granularity instead of a global timeout that affects all requests uniformly. Server-level timeout was considered but rejected because: it applies to the entire TCP connection including response body transfer, which can cause timeouts on large responses.
- **Database-level timeout (`statement_timeout`)** — Chose HTTP-level timeout as primary defense over DB-level because: it provides a consistent 408 response to the client and works for all slow operations (not just DB queries). DB-level timeout was considered but rejected as the sole approach because: it returns a PostgreSQL error, not a clean HTTP 408, and does not cover non-DB operations (external API calls, file I/O).
- **Circuit breaker pattern** — Chose simple timeout over circuit breaker because: the project does not have enough external service calls to justify the complexity. Circuit breaker was considered but rejected because: it requires tracking failure rates and half-open states, which is overkill for a single-service architecture.

### Data Flow Diagram

```
Request → [requestTimeout middleware]
    ↓
  [start timer: timeoutMs]
    ↓
[middleware chain → handler]
    ↓
  [response sent before timer?]
    ├─ Yes → normal 200 response
    └─ No  → timer fires
                ↓
        408 Request Timeout
                ↓
        req.destroy() → close connection
                ↓
        [slowRequestLogger fires on finish]
                ↓
        log: "Slow request: GET /tickets took 31000ms"
```

### Config / Env Changes

- NEW: `backend/.env.example` — add `REQUEST_TIMEOUT_MS=30000`, `SLOW_REQUEST_THRESHOLD_MS=5000`
- NEW: `backend/src/middleware/requestTimeout.js` — timeout middleware factory
- NEW: `backend/src/middleware/slowRequest.js` — slow request logger middleware
- CHANGED: `backend/src/api/routes.js` — apply `requestTimeout()` to all routes, use custom timeout for long-running endpoints

---

## Dependencies

- **None** — self-contained change
- **Winston logger** — already in use for slow request logging

---

## Risks/Edge Cases

- **[DB locks]**: Timeout kills the HTTP response but not the DB query. Mitigation: use `pg` query timeout as secondary defense.
- **[Long-running tasks]**: Billing reports, memory searches may legitimately take >30s. Mitigation: per-endpoint timeout config.
- **[Client-side behavior]**: 408 response — clients should retry with exponential backoff.

---

*Ready for implementation phase.*
