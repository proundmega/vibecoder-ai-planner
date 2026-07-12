# 01_ARCHITECT_REQUIREMENT.md — Prometheus Metrics Export

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1 (Observability)
**Effort**: Medium

---

## Requirement

Add a Prometheus-format `/metrics` endpoint to expose server metrics for monitoring with Prometheus/Grafana. Currently, the `/metrics` endpoint returns JSON (not Prometheus format), and there's no instrumentation for request counts, response times, or DB pool stats.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] `/metrics` endpoint exists: `backend/src/api/routes.js:145` — returns JSON (NOT Prometheus format)
- [x] DB pool stats available: `backend/src/db.js:18` — `pool.stats()` returns totalCount, idleCount, waitingCount
- [x] Request metrics in memory: `backend/src/middleware/requestLogger.js` — sliding windows tracking requests/errors/duration
- [x] Health check exists: `/health` endpoint

### Missing
- No `prom-client` library installed
- No Prometheus-format endpoint (current `/metrics` is JSON)
- No request duration histograms
- No DB pool metrics (count, active, idle, waiting)
- No process metrics (heap, CPU, uptime)

### Key Insight

The `/metrics` endpoint exists but returns JSON. We need:
1. Install `prom-client` library
2. Add a new `/metrics` route (Prometheus format) — or rename current to `/api/metrics` (JSON)
3. Instrument request durations as histograms
4. Export DB pool stats as gauges
5. Export process metrics (nodejs_*)

---

## Scope

### In Scope
- Install `prom-client` npm package
- Add Prometheus `/metrics` endpoint (text/plain format)
- Rename current JSON `/metrics` to `/api/metrics` (backward compatible)
- Request duration histogram (labels: method, path, status)
- Request counter (labels: method, path, status)
- DB pool gauges (totalCount, idleCount, waitingCount)
- Process metrics (already handled by prom-client auto-collection)
- Health endpoint returns 200 only if DB is healthy
- Tests: unit tests for metrics endpoint

### Out of Scope
- Grafana dashboards (separate ticket)
- Alerting rules
- Metric retention configuration
- Custom business metrics (billing, usage — deferred to bp-04)

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/package.json` | MODIFY | Add `prom-client` dependency |
| `backend/src/api/routes.js` | MODIFY | Rename `/metrics` to `/api/metrics`, add Prometheus `/metrics` |
| `backend/src/middleware/requestLogger.js` | MODIFY | Push metrics to prom-client instead of in-memory windows |
| `backend/src/db.js` | MODIFY | Add prom-client gauges for pool stats |
| `backend/src/__tests__/metrics.test.js` | CREATE | Unit tests for metrics endpoint |

---

## Known Unknowns

1. **Should `/metrics` be public or auth-gated?** — Assumed public (standard Prometheus pattern). Can be firewall-restricted in production.
2. **Should we keep the JSON `/metrics` endpoint?** — Assumed YES, rename to `/api/metrics` for backward compatibility.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Auth on `/metrics` endpoint?** — Public (standard Prometheus) — or require auth? — {{public / auth-gated}}
2. **Keep JSON `/metrics` or remove it?** — Keep as `/api/metrics` — or remove? — {{keep as /api/metrics / remove}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend API] `prom-client` installed
2. [ ] [Backend API] `/metrics` returns Prometheus text format (text/plain)
3. [ ] [Backend API] `/api/metrics` returns existing JSON format (backward compat)
4. [ ] [Backend API] Request duration histogram exported (http_request_duration_seconds)
5. [ ] [Backend API] Request counter exported (http_requests_total)
6. [ ] [Backend API] DB pool gauges exported (db_pool_total, db_pool_idle, db_pool_waiting)
7. [ ] [Backend API] Process metrics exported (nodejs_*)
8. [ ] [Tests] Unit tests for metrics endpoint
9. [ ] [Coverage] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Grafana dashboards
- Alerting rules
- Metric retention configuration
- Custom business metrics (billing, usage)

---

## Performance Considerations

- Expected load: Prometheus scrapes every 15-30s
- Histogram buckets: use default prom-client buckets (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
- No blocking I/O in metrics collection
- Pool stats collected at scrape time (cheap operation)

---

## Security Considerations

- [ ] No sensitive data exposed in metrics (no PII, no keys, no tokens)
- [ ] Metrics endpoint accessible without auth (standard Prometheus pattern)
- [ ] Can be firewall-restricted in production

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/metrics.test.js` — test metrics endpoint response format
- [ ] Test histogram buckets are populated
- [ ] Test DB pool gauges reflect actual pool state
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
