# BA-7: Monitoring & Logging

**Status**: planned
**Priority**: P1
**Effort**: Small
**Dependencies**: None

---

### a) Purpose

Monitoring and logging provide visibility into application health, performance, and errors. They enable rapid incident response, capacity planning, and debugging. Good logging captures the "who, what, when" of every significant operation without flooding storage.

### b) Actions

1. Audit existing logging setup:
   - `winston` is imported but may not be configured
   - Console logs scattered across controllers/services — standardize
2. Configure structured logging with winston:
   ```javascript
   // config/logger.js
   const winston = require('winston');

   const logger = winston.createLogger({
     level: process.env.LOG_LEVEL || 'info',
     format: winston.format.combine(
       winston.format.timestamp(),
       winston.format.json()
     ),
     transports: [
       new winston.transports.Console(),
       ...(process.env.NODE_ENV === 'production'
         ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' })]
         : []),
     ],
   });

   module.exports = logger;
   ```
3. Add request ID tracking:
   ```javascript
   // middleware/requestId.js
   function requestId(req, res, next) {
     req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
     res.setHeader('X-Request-ID', req.requestId);
     next();
   }
   ```
4. Add request/response logging middleware:
   ```javascript
   // middleware/requestLogger.js
   function requestLogger(req, res, next) {
     const start = Date.now();
     res.on('finish', () => {
       logger.info({
         method: req.method,
         path: req.originalUrl,
         status: res.statusCode,
         duration: Date.now() - start,
         requestId: req.requestId,
         userId: req.user?.userId,
       });
     });
     next();
   }
   ```
5. Add health check endpoint:
   ```javascript
   // /api/health — already exists, enhance with dependency checks
   router.get('/health', async (req, res) => {
     try {
       await pool.query('SELECT 1');
       res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
     } catch (error) {
       res.status(503).json({ status: 'degraded', database: 'disconnected', error: error.message });
     }
   });
   ```
6. Add performance metrics:
   - Track API response times (p50, p95, p99)
   - Track error rates by endpoint
   - Track database query times

**Current issues to fix:**
- Winston is mocked in tests but may not be configured in production
- `console.error()` used throughout — replace with structured logger
- No request ID correlation — hard to trace logs across services
- No health check for database connectivity
- No metrics endpoint for monitoring tools (Prometheus, Datadog)

### c) Dependencies
- `winston` (already in `package.json`)
- `crypto` (built-in Node.js module for UUIDs)
- `pg` (for health check)
- External: Log aggregation (ELK, Datadog, CloudWatch) — optional
- External: Metrics collection (Prometheus, Grafana) — optional

### d) Risks/Edge Cases
- **Log injection**: User input in logs can inject log lines — sanitize or use structured logging
- **Sensitive data**: Logging request bodies may capture passwords, tokens — filter `req.body` before logging
- **Log volume**: High-traffic endpoints generating millions of logs — sample or aggregate
- **Disk space**: Log files growing unbounded — configure log rotation (`winston-daily-rotate-file`)
- **Performance**: Synchronous file writes blocking event loop — use async transports
- **Masking**: Error messages revealing internal details to clients — separate internal vs external messages
- **Distributed tracing**: Without request IDs, correlating logs across services is impossible

### e) Testing
- [ ] Winston configured with timestamp and JSON format
- [ ] Request ID middleware: adds `req.requestId`, sets response header
- [ ] Request logger: logs method, path, status, duration, requestId, userId
- [ ] Health check: returns 200 with database status, 503 on failure
- [ ] Production mode: error logs written to file, stack traces excluded
- [ ] Development mode: console output with full error details
- [ ] Sensitive data filtered from logs (passwords, tokens)

---
