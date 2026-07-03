# 02_ARCHITECT_DESIGN.md — Distributed State Management

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Rate limiting, account lockout tracking, and permission caching all use in-memory `Map` objects. In a multi-instance deployment, each process has independent state, making these features ineffective. An attacker can rotate through instances to bypass per-IP rate limits and lockout counters. Additionally, the permission cache has no invalidation mechanism and grows unbounded.

---

## Current State

### Rate Limiter (`middleware/auth.js:186`)
```javascript
const rateLimits = new Map();
// per unique key (IP + route) → { count, resetTime }
// Each `rateLimiter(windowMs, max)` call creates a new Map
```

### Account Lockout (`middleware/auth.js:11`)
```javascript
const failedAttempts = new Map();
// per IP → { count, lockedUntil }
```

### Permission Cache (`services/PermissionService.js`)
```javascript
// init() pre-warms cache from DB at require-time
// no TTL, no invalidation on permission changes
```

### Gap Analysis
- All three are `Map` objects — state is local to the Node process
- No shared storage across instances
- No eviction policy — unbounded growth under sustained traffic
- Permission cache has no TTL or invalidation hook
- Rate limiter factory creates a new Map per middleware instance — multiple route-level rate limiters don't share state

---

## Design

### Option A: Redis Backend (Recommended)

Add a `utils/redis.js` module that exports a Redis client (via `ioredis`). Refactor all three state stores to use Redis with in-memory fallback.

#### Redis Key Schema

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `ratelimit:{route}:{ip}` | Sorted Set | `windowMs` + 10s | Sliding window rate limit — member = timestamp millis, score = timestamp |
| `lockout:{ip}` | String | lockout duration | `{ "count": N, "lockedUntil": timestamp }` as JSON |
| `permcache:{role}` | String | 60s | Serialized array of permission strings for a role |

#### Rate Limiting Algorithm (Sliding Window via Redis)

```lua
-- KEYS[1] = ratelimit:{route}:{ip}
-- ARGV[1] = windowMs (e.g., 60000)
-- ARGV[2] = maxRequests (e.g., 5)
-- ARGV[3] = now (current timestamp)

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[3] - ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then
  return 1  -- rate limited
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[3] .. ':' .. math.random())
redis.call('EXPIRE', KEYS[1], math.ceil(ARGV[1] / 1000) + 1)
return 0  -- allowed
```

#### Circuit-Breaker Fallback

```javascript
class RedisState {
  async get(key) {
    try {
      return await this.redis.get(key);
    } catch (err) {
      logger.warn('Redis unavailable, falling back to in-memory', err);
      return this.fallback.get(key);
    }
  }
  // ... similar pattern for set, del, zadd, etc.
}
```

On Redis failure, each operation falls back to the in-memory Map. On Redis recovery, operations switch back to Redis transparently.

### Option B: PostgreSQL-based

Use `pg` advisory locks or a `rate_limits` table. Slower than Redis, adds write pressure to the primary DB. Not recommended for high-throughput rate limiting.

### Option C: External API Gateway

Offload rate limiting to a reverse proxy (nginx, Kong, AWS API Gateway). This would not solve the lockout tracking or permission caching issues. Out of scope for this ticket.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/utils/redis.js` | CREATE | Redis connection singleton, prefix helper, health check, circuit-breaker |
| `backend/src/middleware/auth.js` | MODIFY | Replace `rateLimits` Map with Redis `rateLimiter()`; replace `failedAttempts` Map with Redis-backed lockout functions |
| `backend/src/services/PermissionService.js` | MODIFY | Replace in-memory cache with Redis-backed cache with TTL; add invalidation method (`invalidateRoleCache`) |
| `backend/src/services/UserService.js` | MODIFY | Call `PermissionService.invalidateRoleCache()` when user role changes |
| `backend/src/utils/shutdown.js` | MODIFY | Add `redis.quit()` to cleanup hooks |
| `backend/src/utils/envValidation.js` | MODIFY | Add `REDIS_URL` validation for production |
| `backend/package.json` | MODIFY | Add `ioredis: ^5.4.1` |
| `docker-compose.yml` | MODIFY | Add `redis: { image: redis:7-alpine, ... }` service |
| `backend/.env.example` | MODIFY | Add `REDIS_URL=redis://localhost:6379` |
| `backend/src/__tests__/jest.setup.js` | MODIFY | Add Redis mock setup |
| `backend/src/__tests__/redis.test.js` | CREATE | Redis connection, reconnection, fallback, shutdown |
| `backend/src/__tests__/rateLimiter.test.js` | EXTEND | Redis-backed rate limit algorithm tests |
| `backend/src/__tests__/auth.test.js` | EXTEND | Redis-backed lockout tracking tests |
| `backend/src/__tests__/permissionService.test.js` | EXTEND | Redis-backed cache with invalidation tests |

---

## Data Flow Diagram

### Rate Limiting Flow
```
Request → rateLimiter middleware → Redis Sorted Set (ZADD/ZREMRANGE)
  → Redis available? → YES → check count vs limit → pass or 429
                     → NO  → in-memory Map fallback → pass or 429
```

### Lockout Tracking Flow
```
Login attempt → recordFailedAttempt(ip) → Redis SETEX (lockout key)
  → Next login → checkAccountLockout(ip) → Redis GET (lockout key)
  → On success → clearFailedAttempts(ip) → Redis DEL (lockout key)
```

### Permission Cache Flow
```
Request → requireAnyPermission middleware → Redis GET (permcache:{role})
  → Cache hit? → YES → return cached permissions
               → NO  → DB query → Redis SETEX (60s TTL) → return
  → On role change → invalidateRoleCache(role) → Redis DEL (permcache:{role})
```

---

## Dependencies

### Backend Dependencies
- `ioredis: ^5.4.1` — Redis client with built-in cluster/Sentinel support, promise-based API, and reconnect logic

### Cross-Cutting Dependencies
- Docker Compose: new `redis` service
- CI: Redis service needs to be available for integration tests (GitHub Actions has built-in Redis service)
- Env vars: `REDIS_URL` with default `redis://localhost:6379`

---

## Config / Environment Changes

- [x] New environment variables: `REDIS_URL` (required in production, optional in dev with fallback to in-memory)
- [ ] New database migrations: NONE
- [x] New npm dependencies: `ioredis: ^5.4.1`
- [ ] Existing config changes: NONE

---

## Security Considerations

- [ ] Authentication required: Redis should not have authentication in the internal Docker network; if external, `REDIS_URL` should include password
- [ ] Authorization check: NO
- [ ] Input validation: NO
- [ ] Rate limiting: YES — the entire point of this change
- [ ] Sensitive data handling: No PII or secrets stored in Redis; rate limit keys are IP-based, but IPs are not secrets
- [ ] SQL injection protection: N/A — no SQL

---

## Risks and Edge Cases

### Backend Risks
- **[Redis SPOF]**: If Redis goes down, rate limiting and lockout fall back to in-memory. This is acceptable for short outages but would degrade multi-instance protection. Mitigation: Add Redis Sentinel or Redis Cluster for production.
- **[Key space explosion]**: If an attacker uses randomized IPs (via proxy), the sorted set grows. Mitigation: TTL on every key ensures cleanup. Lua script trims old entries before counting.

### Edge Cases
- **[Redis reconnection]**: `ioredis` has built-in reconnect. The circuit-breaker should detect reconnection and switch back to Redis automatically.
- **[Clock skew]**: Rate limiter uses Redis server time via `TIME` command in Lua script, not client timestamp, to avoid clock skew issues.
- **[Concurrent requests at boundary]**: The Lua script is atomic — no race condition on the count increment.

---

## Alternative Designs Considered

### Alternative 1: PostgreSQL-based rate limiting
- **Pros**: No new infrastructure, uses existing DB
- **Cons**: DB write pressure per request, slower than Redis, connection pool contention
- **Decision**: Redis is the standard for rate limiting. Adding Redis is a one-time infra cost that scales better.

### Alternative 2: In-memory with sticky sessions
- **Pros**: No infra change
- **Cons**: Breaks if any load balancer routes to wrong instance; doesn't work with Kubernetes pods restarting
- **Decision**: Sticky sessions are brittle and don't solve the problem — they just delay it.

### Alternative 3: External API Gateway (nginx rate_limit_conn/req)
- **Pros**: Offloads from app, no code change
- **Cons**: Doesn't solve lockout tracking or permission caching; nginx rate limiting is per-worker, not shared
- **Decision**: Only solves 1/3 problems; doesn't integrate with our auth system.
