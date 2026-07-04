# 01_ARCHITECT_REQUIREMENT.md — Distributed State Management

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Large

---

## Requirement

Replace all in-memory per-process state stores with a shared Redis backend so that rate limiting, account lockout tracking, and permission caching work correctly across multiple backend instances.

**Problem**: Currently three critical state stores are in-memory `Map` objects:
1. Rate limiter window counters (`middleware/auth.js:186` — `const rateLimits = new Map()`) — unbounded growth; state not shared across instances; attacker can rotate through instances to bypass limits
2. Auth lockout tracking (`middleware/auth.js:11` — `const failedAttempts = new Map()`) — 10-attempt lockout bypassable by switching instances
3. Permission cache (`services/PermissionService.js` — in-memory cache) — empty cache on cold start locks all users out; not invalidated when permissions change

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] Rate limiter middleware exists: `middleware/auth.js` — factory function `rateLimiter(windowMs, maxRequests)`
- [x] Account lockout functions exist: `middleware/auth.js` — `checkAccountLockout`, `recordFailedAttempt`, `clearFailedAttempts`, `getLockoutRemainingMs`
- [x] Permission cache exists: `services/PermissionService.js` — `init()`, `hasPermission()`
- [ ] Route is mounted: N/A (middleware applied per-route)
- [ ] OpenAPI JSDoc annotations: N/A (no new endpoints)

### Frontend API Client Check
- [ ] API client exists: N/A — no frontend changes

### Frontend UI Check
- [ ] View component exists: N/A — no frontend changes

### Integration Check
- [ ] All three state stores are in `middleware/auth.js` and `services/PermissionService.js`
- [ ] Env var pattern: existing code uses `process.env.REDIS_URL` or similar — need to check/add

### Key Insight
This is BACKEND-ONLY. The rate limiter, lockout tracker, and permission cache are all backend middleware/services. No frontend changes.

---

## Scope

### In Scope
- Replace `Map`-based rate limiter in `middleware/auth.js` with Redis-backed counter using sliding window
- Replace `Map`-based lockout tracking in `middleware/auth.js` with Redis-backed TTL entries
- Replace in-memory permission cache in `services/PermissionService.js` with Redis-backed cache with invalidation on role/permission changes
- Add Redis connection module (`utils/redis.js`) with connection pooling and graceful shutdown
- Add circuit-breaker fallback to in-memory behavior when Redis is unavailable
- Add Redis service to `docker-compose.yml` (production and development)
- Add `REDIS_URL` env var to `.env.example` and backend startup validation
- Update `utils/shutdown.js` to gracefully disconnect Redis
- Update `utils/envValidation.js` to require `REDIS_URL` when `NODE_ENV=production`
- Unit tests for Redis-backed rate limiter, lockout tracker, and permission cache
- Integration tests: rate limit across requests, lockout across multiple attempts, cache invalidation

### Out of Scope
- Adding rate limiting to new endpoints beyond what currently exists
- Changing rate limit values or lockout thresholds
- Replacing other in-memory state (e.g., `PoolManager.pool` Map — separate concern)
- Frontend changes
- Database migrations
- Adding any new API endpoints

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/middleware/auth.js` | MODIFY | Rate limiter factory + lockout functions → Redis-backed |
| `backend/src/services/PermissionService.js` | MODIFY | `init()` and `hasPermission()` → Redis cache with TTL |
| `backend/src/utils/redis.js` | CREATE | Redis connection singleton, health check, prefix support |
| `backend/src/utils/shutdown.js` | MODIFY | Add Redis `quit()` call |
| `backend/src/utils/envValidation.js` | MODIFY | Add `REDIS_URL` validation for production |
| `backend/package.json` | MODIFY | Add `ioredis` dependency |
| `docker-compose.yml` | MODIFY | Add `redis` service definition |
| `backend/.env.example` | MODIFY | Add `REDIS_URL` with default |
| `backend/src/__tests__/rateLimiter.test.js` | MODIFY/EXTEND | Tests for Redis-backed rate limiter |
| `backend/src/__tests__/auth.test.js` | MODIFY/EXTEND | Tests for Redis-backed lockout |
| `backend/src/__tests__/permissionService.test.js` | MODIFY/EXTEND | Tests for Redis-backed permission cache |
| `database` | NONE | No DB changes |
| `config` | MODIFY | New env var `REDIS_URL` |

---

## Known Unknowns

1. **[Redis availability]**: How should the app behave when Redis is unreachable? — Fallback to in-memory behavior with a log warning. The circuit-breaker pattern should be implemented.
2. **[Cache invalidation trigger]**: When should the permission cache be invalidated? — On user role change, permission grant/revoke. Need to find all mutation points in `UserService.js` and `PermissionService.js`.
3. **[Existing test mocks]**: The current jest setup mocks `jsonwebtoken`, `pg`, etc. The new Redis module will also need to be mockable. — `ioredis` can be mocked with `ioredis-mock` or manual mock.

---

## Important Design Decisions

1. **Redis vs. alternative**: Use Redis (via `ioredis`). Redis is the standard for distributed rate limiting, has built-in TTL support, and is widely deployed alongside Node.js. Alternatives like in-memory shared via `cluster` module or PostgreSQL `pg_advisory_lock` are more complex or slower.
2. **Rate limiting algorithm**: Sliding window with Redis sorted sets (score = timestamp). This is more accurate than fixed-window and avoids the boundary burst problem. Lua script for atomicity.
3. **Fallback strategy**: If Redis connection fails at startup or during a request, log a warning and fall back to in-memory Map behavior. Do not crash the service for missing Redis in development.

---

## Acceptance Criteria

1. [ ] Rate limiter correctly tracks request counts per route+IP across multiple backend instances
2. [ ] Account lockout tracking persists across instances — 10 failed logins from any instance locks out globally
3. [ ] Permission cache has configurable TTL and is invalidated when user role/permissions change
4. [ ] When Redis is unavailable, all three components fall back to in-memory behavior gracefully
5. [ ] No infinite growth — Redis keys have appropriate TTLs (rate limit windows, lockout duration, cache TTL)
6. [ ] Docker compose includes a Redis service; backend can connect to it via `REDIS_URL`
7. [ ] All existing tests still pass; new tests cover Redis-backed behavior
8. [ ] Graceful shutdown disconnects Redis cleanly
9. [ ] `REDIS_URL` is validated at startup in production

---

## Out of Scope

- Adding rate limiting to new endpoints beyond what currently exists
- Changing rate limit values or lockout thresholds
- Replacing other in-memory state (`PoolManager.pool`, `NodeCache` instances)
- Frontend changes
- Database migrations

---

## Performance Considerations

- Expected load: Up to 100 requests/second per instance, 3-5 instances
- Redis operations: 2-3 per request (rate limiter check → optional lockout check → permission check)
- Cache TTL: Permission cache 60s, rate limit windows equal to window duration, lockout TTL = remaining lockout time
- Lua script for rate limiter is atomic and executes in Redis — minimal network overhead

---

## Security Considerations

- [x] Authentication required: NO — rate limiter runs before auth; lockout tracker is part of auth flow
- [x] Authorization check: NO
- [x] Input validation: NO
- [x] Rate limiting: YES — this is the feature being rebuilt
- [ ] Sensitive data handling: Redis should be on a private network; no PII stored in Redis

---

## Testing Checklist

### Backend Tests
- [ ] Unit test files CREATED for all new/changed backend code
- [ ] Unit tests: `backend/src/__tests__/rateLimiter.test.js` — sliding window algorithm, TTL, edge cases
- [ ] Unit tests: `backend/src/__tests__/auth.test.js` — lockout tracking with Redis, fallback to in-memory
- [ ] Unit tests: `backend/src/__tests__/permissionService.test.js` — cache set/get, invalidation, TTL expiry
- [ ] Unit tests: `backend/src/__tests__/redis.test.js` — connection, reconnection, graceful shutdown
- [ ] Integration tests: Redis-backed rate limiter across multiple simulated instances
- [ ] Integration tests: Lockout persistence after simulated instance restart
- [ ] Integration tests: Permission cache invalidation on role change
- [ ] Happy path AND error paths tested (Redis unavailable, key expiry, concurrent requests)

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass (needs Redis service in CI)
- [ ] `npm run lint` — no lint errors
