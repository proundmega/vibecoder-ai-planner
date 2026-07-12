# 04_SPECIFICATION.md — Prometheus Metrics Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-12

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### MODIFY: `backend/package.json`

**Add to dependencies**:
```json
"prom-client": "^15.0.0"
```

### MODIFY: `backend/src/api/routes.js`

**Add import** (after other imports):
```javascript
const client = require('prom-client');
```

**Add collectDefaultMetrics** (at top of file, after imports):
```javascript
// Collect default process metrics (heap, CPU, event loop, etc.)
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });
```

**Rename existing /metrics to /api/metrics**:
```javascript
// OLD: router.get('/metrics', (req, res) => { ... })
// NEW: router.get('/api/metrics', (req, res) => { ... })
// Keep the entire existing handler, just change the path from '/metrics' to '/api/metrics'
```

**Add Prometheus /metrics endpoint** (after the /api/metrics route):
```javascript
/**
 * @openapi
 * /metrics:
 *   get:
 *     tags: [System]
 *     summary: Prometheus metrics endpoint
 *     responses:
 *       200:
 *         description: Prometheus-format metrics
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get('/metrics', async (req, res, next) => {
  try {
    res.set('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.end(metrics);
  } catch (error) {
    next(error);
  }
});
```

### MODIFY: `backend/src/middleware/requestLogger.js`

**Add imports**:
```javascript
const client = require('prom-client');
const Histogram = client.Histogram;
const Counter = client.Counter;
```

**Add metric collectors** (after require statements, before windowMs):
```javascript
// Request duration histogram
const httpRequestDurationHistogram = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Request counter
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
});
```

**Modify res.end wrapper** (in requestLogger middleware):
```javascript
// In the res.end = function(...args) { ... } block, add AFTER the win.warn++ line:
const path = req.route?.path || req.originalUrl;
httpRequestDurationHistogram.observe(
  { method: req.method, path, status: res.statusCode.toString() },
  duration / 1000  // convert ms to seconds
);
httpRequestsTotal.inc({ method: req.method, path, status: res.statusCode.toString() });
```

### MODIFY: `backend/src/db.js`

**Add imports**:
```javascript
const client = require('prom-client');
const Gauge = client.Gauge;
```

**Add pool gauges** (after pool creation, before pool.on('error')):
```javascript
// DB pool metrics
const dbPoolTotal = new Gauge({
  name: 'db_pool_total',
  help: 'Total connections in the pool',
});

const dbPoolIdle = new Gauge({
  name: 'db_pool_idle',
  help: 'Idle connections in the pool',
});

const dbPoolWaiting = new Gauge({
  name: 'db_pool_waiting',
  help: 'Waiting clients requesting a connection',
});

// Update gauges every 5 seconds
function updatePoolMetrics() {
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount || 0);
}

setInterval(updatePoolMetrics, 5000).unref();
```

### CREATE: `backend/src/__tests__/metrics.test.js`

**Imports**:
```javascript
const request = require('supertest');
const app = require('src/index');
```

**Test stubs**:
```javascript
describe('Prometheus Metrics', () => {
  it('GET /metrics returns Prometheus format', async () => {
    // TODO: implement
  });

  it('GET /api/metrics returns JSON format', async () => {
    // TODO: implement
  });

  it('http_request_duration_seconds histogram is populated', async () => {
    // TODO: implement
  });

  it('db_pool_total gauge reflects actual pool state', async () => {
    // TODO: implement
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — Prometheus Metrics
```
✓ [happy] GET /metrics returns 200 with text/plain content-type
✓ [happy] GET /metrics contains http_request_duration_seconds histogram
✓ [happy] GET /metrics contains http_requests_total counter
✓ [happy] GET /metrics contains db_pool_total gauge
✓ [happy] GET /metrics contains nodejs_heap_used_bytes (process metric)
✓ [happy] GET /api/metrics returns 200 with application/json content-type
✓ [happy] GET /api/metrics contains uptime field
✓ [edge] Histogram is populated after making requests
✓ [edge] db_pool_total reflects actual pool.totalCount
```

---

## Edge Cases to Handle

1. **[First request]**: Histogram has no data on first request — prom-client returns 0 for all buckets
2. **[DB pool disconnected]**: Pool stats unavailable — return 0 for all gauges (handled by setInterval)
3. **[High request rate]**: 1000+ requests/sec — prom-client is async, no blocking
4. **[Label cardinality]**: High-cardinality labels would cause memory issues — only use method, path, status as labels

---

## Existing Code Patterns to Follow

- Use `prom-client` Histogram/Counter/Gauge for metrics
- Prometheus metrics use seconds for durations, not milliseconds
- HTTP labels: method (GET/POST/PUT/DELETE), path (route pattern), status (200/401/403/404/500)
- Process metrics (nodejs_*) are auto-collected by prom-client
- Tests use supertest against Express app (same pattern as existing tests)

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `frontend/src/` — no frontend changes needed
- `backend/src/controllers/` — no controller changes
- `backend/src/services/` — no service changes
- `docker-compose.yml` — no infrastructure changes (Prometheus can be added later)

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
