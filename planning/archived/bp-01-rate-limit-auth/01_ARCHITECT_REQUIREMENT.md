# 01_ARCHITECT_REQUIREMENT.md — Rate Limiting on Auth Endpoints

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Auth endpoints (`/api/auth/register`, `/api/auth/login`) must have rate limiting to prevent brute force attacks and credential stuffing.

---

## Scope

- Apply `rateLimiter` middleware to `/auth/register` and `/auth/login`
- Different limits for login (stricter) vs register (looser)
- Return 429 with retry-after header
- Track attempts per IP (not per user — attackers use many accounts)

---

## Assumptions

- `rateLimiter` middleware already exists in `middleware/auth.js` and can be configured with custom options (store, windowMs, max, headers)
- The project uses `express-rate-limit` or equivalent (currently imported in `middleware/auth.js`)
- Rate limit state is stored in-memory (no external Redis/store configured)
- IP detection already works via `req.ip` or `req.connection.remoteAddress`
- The existing `rateLimiter` in `middleware/auth.js` is a generic limiter that can be reused with different parameters
- Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are already included by the existing middleware

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **What are the rate limits?**
   - Login: 5 attempts per minute per IP?
   - Register: 3 attempts per minute per IP?
   - Or something else?

2. **Should we implement account lockout after N failed attempts?**
   - Yes — lock account for 15 minutes after 10 failed attempts
   - No — just rate limit, let the user try again

3. **Should we use IP-based or email-based rate limiting?**
   - IP-based (standard, works with shared IPs)
   - Email-based (more precise, but breaks on shared IPs)

---

## Acceptance Criteria

- [ ] `/api/auth/login` returns HTTP 429 after exceeding the configured rate limit (default: 5 requests/minute per IP)
- [ ] `/api/auth/register` returns HTTP 429 after exceeding the configured rate limit (default: 3 requests/minute per IP)
- [ ] Login rate limit is stricter than register rate limit (login has lower max)
- [ ] 429 response body includes `error` field with human-readable message
- [ ] 429 response includes `Retry-After` header with seconds until reset
- [ ] 429 response includes standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)
- [ ] Rate limit counter resets after the time window expires
- [ ] Rate limit tracks per IP address, not per email or username
- [ ] Rate-limited requests do NOT increment failed login counter (to prevent lockout bypass)
- [ ] Unit tests verify rate limiting behavior with mocked time
- [ ] Linting passes with no errors

---

## Out of Scope

- Account lockout implementation (separate concern — can be added later)
- Rate limiting on other endpoints (password reset, password change)
- Distributed rate limiting (Redis-backed store)
- Rate limit bypass detection (e.g., X-Forwarded-For manipulation)
- Rate limit UI/UX (e.g., showing a countdown to the frontend)
- Rate limit exceptions for whitelisted IPs (admin bypass)

---

## Testing Checklist

- [ ] Login endpoint returns 429 after exceeding rate limit
- [ ] Different rate limits for login vs register
- [ ] Rate limit resets after time window
- [ ] 429 response includes Retry-After header
- [ ] Rate limiter tracks per IP, not per email

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Rate limiting by email (breaks on shared IPs, VPNs)
- ❌ Silent rate limiting (must return 429 with clear message)
- ❌ Rate limiting only on login (register is also targeted)

---

*Ready for design phase.*
