# 02_ARCHITECT_DESIGN.md — Prometheus Metrics Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

No Prometheus-compatible metrics endpoint exists. The current `/metrics` returns JSON (not Prometheus format), making it impossible to monitor with Prometheus/Grafana. This leaves the production system completely unmonitored from an observability standpoint.

---

## Current State

### Existing Backend
- `GET /metrics` — returns JSON with uptime, memory, DB pool stats (NOT Prometheus format)
- `GET /health` — health check endpoint
- `requestLogger.js` — in-memory sliding windows tracking requests/errors/duration
- `db.js` — `pool.stats()` returns totalCount, idleCount, waitingCount
- No `prom-client` library installed

### Gap Analysis
- JSON `/metrics` endpoint exists but not Prometheus-compatible
- No request duration histograms
- No DB pool metrics in Prometheus format
- No process metrics (heap, CPU, uptime in Prometheus format)

---

## Design

### Option A: Extend Existing Structure (Recommended)

```
Install prom-client:
  npm install prom-client

Rename existing /metrics to /api/metrics:
  backend/src/api/routes.js
    → /api/metrics → JSON format (backward compat)
    → /metrics → Prometheus format (text/plain)

Request metrics:
  backend/src/middleware/requestLogger.js
    → Add prom-client Histogram for duration
    → Add prom-client Counter for requests
    → Labels: method, path, status

DB pool metrics:
  backend/src/db.js
    → Add prom-client Gauge for pool stats
    → Export: db_pool_total, db_pool_idle, db_pool_waiting

Process metrics:
  prom-client auto-collects nodejs_* metrics
    → heapUsed, heapTotal, rss, eventLoopDelay, etc.
```

### Option B: Separate Metrics Module
- Create `backend/src/middleware/metrics.js` for all prom-client setup
- More modular but adds another file
- Would require new import in routes.js

### Option C: Use Existing requestLogger Windows
- Push in-memory window data to prom-client as gauges
- More complex, duplicates data collection
- Would require refactoring requestLogger

**Decision**: Option A — extend routes.js and requestLogger.js. Minimal new files, follows existing patterns.

---

## API Design

### Prometheus `/metrics` Response Format
```
# HELP http_request_duration_seconds Request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",path="/api/health",status="200",le="0.005"} 150
http_request_duration_seconds_bucket{method="GET",path="/api/health",status="200",le="0.01"} 200
...
http_request_duration_seconds_sum{method="GET",path="/api/health",status="200"} 12.5
http_request_duration_seconds_count{method="GET",path="/api/health",status="200"} 250

# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/health",status="200"} 1000
http_requests_total{method="POST",path="/api/v1/tickets",status="201"} 50

# HELP db_pool_total Total connections in pool
# TYPE db_pool_total gauge
db_pool_total 20

# HELP db_pool_idle Idle connections in pool
# TYPE db_pool_idle gauge
db_pool_idle 15

# HELP db_pool_waiting Waiting clients
# TYPE db_pool_waiting gauge
db_pool_waiting 0

# HELP nodejs_heap_used_bytes Used heap size
# TYPE nodejs_heap_used_bytes gauge
nodejs_heap_used_bytes 45000000
```

### JSON `/api/metrics` Response (unchanged)
```json
{
  "success": true,
  "data": {
    "uptime": 86400,
    "memoryUsage": {"rss": 128000000, "heapUsed": 45000000, ...},
    "timestamp": "2025-07-12T12:00:00.000Z",
    "database": {
      "totalCount": 20,
      "idleCount": 15,
      "waitingCount": 0,
      "status": "healthy"
    }
  }
}
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/metrics.test.js` | Prometheus format, JSON format, histogram population |
| Jest integration | Jest + supertest | `backend/src/__tests__/metricsApi.test.js` | HTTP response format, content-type headers |

### Bash Integration Suite

Add `backend/integration-test/suites/metrics.test.sh`:
```bash
# 1. GET /metrics returns text/plain
# 2. Response contains http_request_duration_seconds
# 3. Response contains db_pool_total
# 4. GET /api/metrics returns application/json
# 5. Response contains uptime field
```

---

## Risks and Edge Cases

### Backend Risks
- **[Content-Type conflict]**: Both `/metrics` and `/api/metrics` could conflict — Mitigation: Different paths, different content-types
- **[Label cardinality]**: High-cardinality labels (e.g., user IDs) would cause memory issues — Mitigation: Only use method, path, status as labels
- **[Memory leak]**: Histogram buckets accumulate over time — Mitigation: prom-client handles this, no manual cleanup needed

### Edge Cases
- **[First request]**: Histogram has no data on first request — Handle: Return 0 for all buckets
- **[DB pool disconnected]**: Pool stats unavailable — Handle: Return 0 for all gauges
- **[High request rate]**: 1000+ requests/sec — Handle: prom-client is async, no blocking

---

## Alternative Designs Considered

### Alternative 1: Use Existing requestLogger Windows
- **Pros**: No new data collection, reuses existing windows
- **Cons**: More complex, duplicates data, windows are in-memory only
- **Decision**: Use prom-client native collectors instead

### Alternative 2: Separate Metrics Middleware
- **Pros**: Cleaner separation of concerns
- **Cons**: Adds another file, more imports
- **Decision**: Extend existing requestLogger.js (already tracks durations)

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

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
