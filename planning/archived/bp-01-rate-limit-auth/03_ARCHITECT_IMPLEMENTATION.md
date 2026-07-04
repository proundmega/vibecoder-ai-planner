# 03_ARCHITECT_IMPLEMENTATION.md — Rate Limiting on Auth Endpoints

**Status**: planned
**Priority**: P1 (High)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-01-rate-limit-auth

**Dependencies**: None

---

### a) Purpose

Add rate limiting and account lockout to auth endpoints to prevent brute force attacks and credential stuffing.

**Value delivered**: Protects user accounts from automated attacks without blocking legitimate users.

---

### b) Actions

1. **Create rate limit middleware wrapper** — `backend/src/middleware/rateLimiter.js` (rename from auth.js)
   - Extract `rateLimiter(maxRequests, timeWindow)` to its own file
   - Add `checkAccountLockout(ip)` function
   - Add `recordFailedAttempt(ip)` function
   - Add `clearFailedAttempts(ip)` function on successful login

2. **Apply rate limiting to auth routes** — `backend/src/api/routes.js`
   - `POST /auth/login` → `rateLimiter(5, 60000)` (5/min)
   - `POST /auth/register` → `rateLimiter(3, 60000)` (3/min)
   - Both return 429 with `Retry-After` header

3. **Create rate limit response middleware** — `backend/src/middleware/rateLimitResponse.js`
   - Extract rate limit headers from `req.rateLimits`
   - Add `X-RateLimit-*` headers to all responses
   - Add `Retry-After` header when 429

4. **Update tests**
   - `backend/src/__tests__/rateLimiter.test.js` — rate limit tests
   - `backend/src/__tests__/accountLockout.test.js` — lockout tests

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Shared IPs]**: Office/VPN users share IP — rate limit applies to all. Mitigation: use email-based tracking as secondary check.
- **[In-memory Map]**: Loses state on restart. For production: use Redis or database.
- **[Lockout abuse]**: Attacker locks out their own IP to block others. Mitigation: short lockout window (15 min).

---

### e) Testing

#### Unit Tests
- [ ] rateLimiter blocks after N requests in time window
- [ ] rateLimiter allows after time window expires
- [ ] Account lockout after 10 failed attempts
- [ ] Account unlocks after 15 minutes
- [ ] Successful login clears failed attempts

#### Integration Tests
- [ ] POST /auth/login returns 429 after 5 requests in 1 minute
- [ ] POST /auth/register returns 429 after 3 requests in 1 minute
- [ ] 429 response includes Retry-After header

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/middleware/rateLimiter.js` — NEW
- `backend/src/middleware/rateLimitResponse.js` — NEW
- `backend/src/api/routes.js` — CHANGED
- `backend/.env.example` — CHANGED
- `backend/src/__tests__/rateLimiter.test.js` — NEW
- `backend/src/__tests__/accountLockout.test.js` — NEW

---

### h) Code Review Checklist

- [ ] Rate limit values are reasonable (5/min for login, 3/min for register)
- [ ] No passwords or tokens are logged in rate limiter state
- [ ] Error messages are user-friendly (no stack traces in 429 response)
- [ ] All error paths return proper HTTP status codes (429 for rate limit, 401 for lockout)
- [ ] Retry-After header is present and correctly formatted
- [ ] In-memory Map is cleared on startup to prevent stale state accumulation

---

### i) Post-Deploy Verification

- [ ] Check /metrics endpoint shows rate limiter stats (if applicable)
- [ ] Monitor error rate for 15 minutes — no unexpected 429 spikes
- [ ] Test a login attempt to confirm rate limiting works
- [ ] Verify X-RateLimit headers appear on successful responses
- [ ] Confirm legitimate users are not locked out after deployment

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Rate limits: login 5/min, register 3/min
- Account lockout: 10 failed attempts → 15 min lock
- In-memory tracking (Map) — upgrade to Redis for production
- Rate limit headers on all responses for debugging

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, rate limits, lockout logic, response format*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
