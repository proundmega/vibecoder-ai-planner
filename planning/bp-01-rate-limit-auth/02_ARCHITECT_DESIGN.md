# 02_ARCHITECT_DESIGN.md — Rate Limiting on Auth Endpoints

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

`rateLimiter` middleware exists in `backend/src/middleware/auth.js` but is not applied to auth endpoints. Attackers can brute force login or spam registration.

---

## Current State

- `rateLimiter(maxRequests, timeWindow)` middleware exists in `auth.js`
- No rate limiting on `/auth/register` or `/auth/login`
- No account lockout mechanism
- No 429 responses

---

## Design

### Rate Limits

```javascript
// Login: 5 attempts per minute per IP
router.post('/auth/login', rateLimiter(5, 60000), validate(loginSchema), async (req, res) => { ... });

// Register: 3 attempts per minute per IP
router.post('/auth/register', rateLimiter(3, 60000), validate(registerSchema), async (req, res) => { ... });
```

### Account Lockout

```javascript
// Track failed login attempts per IP
const failedAttempts = new Map(); // ip -> { count, lockedUntil }

function checkAccountLockout(ip) {
  const attempt = failedAttempts.get(ip);
  if (!attempt) return false;
  if (attempt.count >= 10 && Date.now() < attempt.lockedUntil) {
    return true; // locked
  }
  if (attempt.count >= 10 && Date.now() >= attempt.lockedUntil) {
    failedAttempts.delete(ip); // unlock after 15 min
    return false;
  }
  return false;
}
```

### Response Format

```json
{
  "error": "Too many login attempts. Try again in 45 seconds.",
  "retryAfter": 45
}
```

### HTTP Headers

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1624441200
Retry-After: 45
```

### Architecture

```
Request → rateLimiter → checkAccountLockout → validate → handler
                                    ↓
                              429 if locked
```

### Alternative Designs Considered

- **Redis-backed rate limiting** — Chose in-memory Map over Redis because: the project has no Redis dependency, and for a single-instance deployment the Map is sufficient. Redis was considered but rejected because it adds infrastructure complexity for a feature that can work locally with basic tracking.
- **Email-based lockout** — Chose IP-based lockout over email-based because: IP tracking is faster to implement and covers the brute-force vector without requiring email verification flow changes. Email-based lockout was considered but rejected because: it requires storing attempt counts per email, which adds a DB write on every failed login and complicates the lockout recovery flow.
- **Sliding window vs fixed window** — Chose fixed window (per-minute bucket) over sliding window because: simpler to implement with `rateLimiter` middleware and the 1-minute window is short enough that drift is negligible. Sliding window was considered but rejected because: it requires tracking individual timestamps, which is more memory-intensive for the in-memory Map approach.

### Data Flow Diagram

```
Client Request
    ↓
[rateLimiter middleware]
    ↓ count request for IP in last 60s
    ↓
  ≥ maxRequests?
    ├─ Yes → 429 Too Many Requests (Retry-After header)
    └─ No  → continue
                ↓
      [checkAccountLockout]
                ↓
      locked?
        ├─ Yes → 429 Account Locked (Retry-After header)
        └─ No  → continue
                    ↓
      [validate schema] → [handler] → response
```

### Config / Env Changes

- NEW: `backend/.env.example` — add `AUTH_RATE_LIMIT_LOGIN=5`, `AUTH_RATE_LIMIT_REGISTER=3`, `AUTH_LOCKOUT_ATTEMPTS=10`, `AUTH_LOCKOUT_WINDOW_MS=900000`
- CHANGED: `backend/src/api/routes.js` — apply `rateLimiter` to `/auth/login` and `/auth/register`
- CHANGED: `backend/src/middleware/auth.js` — export `checkAccountLockout` function, add account lockout tracking to `rateLimiter`
- NEW: `backend/src/middleware/accountLockout.js` — in-memory lockout store with cleanup interval

---

## Dependencies

- **Existing**: `rateLimiter` middleware in `auth.js`
- **New**: Account lockout tracking (in-memory Map, or Redis for production)

---

## Risks/Edge Cases

- **[Shared IPs]**: Office/VPN users share IP — rate limit applies to all. Mitigation: use email-based tracking as secondary check.
- **[In-memory Map]**: Loses state on restart. For production: use Redis or database.
- **[Lockout abuse]**: Attacker locks out their own IP to block others. Mitigation: short lockout window (15 min), or allow IP whitelisting.
- **[DDoS]**: Rate limiting helps but doesn't stop volumetric attacks. Use CDN/WAF for that.

---

*Ready for implementation phase.*
