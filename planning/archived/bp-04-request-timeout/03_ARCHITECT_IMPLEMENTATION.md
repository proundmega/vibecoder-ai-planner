# 03_ARCHITECT_IMPLEMENTATION.md — Request Timeout

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-04-request-timeout

**Dependencies**: None

---

### a) Purpose

Add request timeout to prevent slow queries from hanging indefinitely and consuming connections. Add slow request logging for monitoring.

**Value delivered**: Prevents connection exhaustion, provides observability into slow endpoints.

---

### b) Actions

1. **Create timeout middleware** — `backend/src/middleware/requestTimeout.js`
   - `requestTimeout(timeoutMs)` — returns 408 after timeout
   - Default: 30000ms (30 seconds)

2. **Create slow request logger** — `backend/src/middleware/slowRequest.js`
   - `slowRequestLogger(thresholdMs)` — logs requests exceeding threshold
   - Default: 5000ms (5 seconds)

3. **Apply timeout to routes** — `backend/src/api/routes.js`
   - Default timeout on all routes
   - Longer timeout (60s) on billing, usage, memory endpoints

4. **Update .env.example** — `backend/.env.example`
   - Add `REQUEST_TIMEOUT_MS=30000` comment

5. **Create tests**
   - `backend/src/__tests__/requestTimeout.test.js` — timeout tests

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[DB queries still running]**: Timeout kills HTTP response but not DB query. Add `query_timeout` to pg.Pool config.
- **[Long reports]**: Billing/memory endpoints may legitimately take >30s. Use per-endpoint timeout.
- **[Client retry]**: 408 response — clients should retry with backoff.

---

### e) Testing

#### Unit Tests
- [ ] requestTimeout returns 408 after timeoutMs
- [ ] Normal requests complete within timeout
- [ ] slowRequestLogger logs requests exceeding threshold

#### Integration Tests
- [ ] Slow endpoint returns 408 after timeout
- [ ] Fast endpoint completes normally
- [ ] Slow requests logged to console

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/middleware/requestTimeout.js` — NEW
- `backend/src/middleware/slowRequest.js` — NEW
- `backend/src/api/routes.js` — CHANGED
- `backend/.env.example` — CHANGED
- `backend/src/__tests__/requestTimeout.test.js` — NEW

---

### h) Code Review Checklist

- [ ] Default timeout (30s) is reasonable for most endpoints
- [ ] Long-running endpoints (billing, usage, memory) have extended timeout (60s)
- [ ] 408 response body is user-friendly (no stack traces)
- [ ] slowRequestLogger does not log sensitive data (body, headers)
- [ ] Timeout middleware does not interfere with streaming responses
- [ ] REQUEST_TIMEOUT_MS env var is properly read with fallback

---

### i) Post-Deploy Verification

- [ ] Monitor slow request logs for 15 minutes — identify endpoints hitting threshold
- [ ] Check error rate for unexpected 408 responses
- [ ] Verify billing/memory endpoints complete within extended timeout
- [ ] Confirm no connection pool exhaustion in logs

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Default timeout: 30s (configurable via REQUEST_TIMEOUT_MS)
- Slow request threshold: 5s
- Long-running endpoints (billing, usage, memory): 60s
- Timeout kills HTTP response but not DB query — add query_timeout to pg.Pool

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, timeout middleware, slow request logging*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
