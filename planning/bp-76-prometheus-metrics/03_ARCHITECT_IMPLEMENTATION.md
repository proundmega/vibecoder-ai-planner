# 03_ARCHITECT_IMPLEMENTATION.md — Prometheus Metrics Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Install prom-client

```bash
cd backend && npm install prom-client
```

### Phase 2: Add Prometheus Metrics to routes.js

#### `backend/src/api/routes.js` (MODIFY)

**Add import**:
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
// OLD: router.get('/metrics', ...)
// NEW: router.get('/api/metrics', ...)
router.get('/api/metrics', (req, res) => {
  res.json({
    success: true,
    data: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      database: {
        ...pool.stats(),
        status: pool.idleCount > 0 ? 'healthy' : 'degraded',
      },
    },
    requestId: req.requestId,
  });
});
```

**Add Prometheus /metrics endpoint**:
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
router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.end(metrics);
  } catch (error) {
    next(error);
  }
});
```

### Phase 3: Add Request Metrics to requestLogger.js

#### `backend/src/middleware/requestLogger.js` (MODIFY)

**Add imports**:
```javascript
const client = require('prom-client');
const Histogram = client.Histogram;
const Counter = client.Counter;
```

**Add metrics collectors** (at top of file):
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
const requestLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  req.requestId = crypto.randomUUID();
  req.startTime = startTime;

  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e6 / 1000; // seconds
    const win = getOrCreateWindow();
    win.requests++;
    win.totalDuration += duration * 1000; // keep ms for logging

    if (res.statusCode >= 500) {
      win.errors++;
      logger.error(`[${req.method}] ${req.originalUrl} ${res.statusCode} ${Math.round(duration * 1000)}ms`);
    } else if (res.statusCode >= 400) {
      win.warn++;
    }

    // Push to Prometheus
    const path = req.route?.path || req.originalUrl;
    httpRequestDurationHistogram.observe(
      { method: req.method, path, status: res.statusCode.toString() },
      duration
    );
    httpRequestsTotal.inc({ method: req.method, path, status: res.statusCode.toString() });

    originalEnd.apply(res, args);
  };

  next();
};
```

### Phase 4: Add DB Pool Metrics to db.js

#### `backend/src/db.js` (MODIFY)

**Add imports**:
```javascript
const client = require('prom-client');
const Gauge = client.Gauge;
```

**Add pool gauges** (after pool creation):
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

// Update gauges on each scrape
client.register.setDefaultLabels({ app: 'vibecode-backend' });

function updatePoolMetrics() {
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount || 0);
}

// Update every 5 seconds
setInterval(updatePoolMetrics, 5000).unref();
```

### Phase 5: Tests

#### CREATE: `backend/src/__tests__/metrics.test.js`
```javascript
const request = require('supertest');
const app = require('src/index');
const client = require('prom-client');

describe('Prometheus Metrics', () => {
  it('GET /metrics returns Prometheus format', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('db_pool_total');
    expect(res.text).toContain('nodejs_heap_used_bytes');
  });

  it('GET /api/metrics returns JSON format', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.success).toBe(true);
    expect(res.body.data.uptime).toBeDefined();
  });

  it('http_request_duration_seconds histogram is populated', async () => {
    // Make a request first
    await request(app).get('/health');
    
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('http_request_duration_seconds_bucket');
  });
});
```

### Phase 6: OpenAPI Spec

1. Add JSDoc annotations to `/metrics` route (already done in routes.js)
2. Run `cd backend && npm run generate:spec`
3. Run `cd frontend && npm run generate:api` (if types are generated)
4. Run `cd frontend && npm run typecheck`

---

## Files Changed

```
backend/package.json                                        → MODIFY (add prom-client)
backend/src/api/routes.js                                   → MODIFY (rename /metrics, add Prometheus /metrics)
backend/src/middleware/requestLogger.js                     → MODIFY (add prom-client Histogram/Counter)
backend/src/db.js                                           → MODIFY (add prom-client Gauges)
backend/src/__tests__/metrics.test.js                       → CREATE (unit tests)
```

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

Common goldmine categories:
- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Prometheus endpoint accessible: `curl http://localhost:3001/metrics`
5. [ ] JSON endpoint accessible: `curl http://localhost:3001/api/metrics`
6. [ ] Metrics contain expected labels and metrics names
7. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
