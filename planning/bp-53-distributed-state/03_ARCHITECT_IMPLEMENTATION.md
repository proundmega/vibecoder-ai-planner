# 03_ARCHITECT_IMPLEMENTATION.md — Distributed State Management

**Status**: completed
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: 2026-07-06
**PR**: https://github.com/proundmega/vibecoder-ai-planner/pull/38
**Branch**: fix/bp-53-distributed-state
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Replace all in-memory `Map`-based state stores (rate limiter, account lockout, permission cache) with Redis-backed implementations so that these features work correctly across multiple backend instances.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

1. **Add Redis npm dependency** — `backend/package.json`
   - Run: `npm install ioredis`
   - *Depends on*: nothing

2. **Create Redis utility module** — `backend/src/utils/redis.js`
   - Redis connection singleton with reconnect, health check, circuit-breaker to in-memory fallback
   - *Depends on*: Step 1

3. **Add Redis service to Docker Compose** — `docker-compose.yml`
   - Add `redis: { image: redis:7-alpine }` service
   - *Depends on*: nothing (can be done in parallel)

4. **Update env validation and shutdown** — `backend/src/utils/envValidation.js`, `backend/src/utils/shutdown.js`
   - Add `REDIS_URL` validation, add `redis.quit()` to graceful shutdown
   - *Depends on*: Step 2

5. **Refactor rate limiter** — `backend/src/middleware/auth.js`
   - Replace `rateLimits` Map with Redis-backed sliding window via Lua script
   - Keep in-memory fallback for when Redis is unavailable
   - *Depends on*: Step 2

6. **Refactor lockout tracking** — `backend/src/middleware/auth.js`
   - Replace `failedAttempts` Map with Redis-backed TTL entries
   - *Depends on*: Step 2

7. **Refactor permission cache** — `backend/src/services/PermissionService.js`
   - Replace in-memory cache with Redis-backed cache (TTL: 60s)
   - Add `invalidateRoleCache(role)` method
   - *Depends on*: Step 2

8. **Wire cache invalidation** — `backend/src/services/UserService.js`
   - Call `PermissionService.invalidateRoleCache()` when user role changes
   - Find all mutation points (update role, grant/revoke permission)
   - *Depends on*: Step 7

9. **Update tests** — `backend/src/__tests__/`
   - Extend `rateLimiter.test.js`, `auth.test.js`, `permissionService.test.js`
   - Create `redis.test.js` for connection/reconnection/fallback
   - *Depends on*: Steps 5, 6, 7

10. **Update CI** — `.github/workflows/ci.yml`
    - Add Redis service for integration tests
    - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `backend/package.json` (MODIFY)
- **Add dependency**: `"ioredis": "^5.4.1"` to `dependencies`

#### `backend/src/utils/redis.js` (CREATE)
- **Export**: `getRedis()`, `getFallback()`, `isRedisAvailable()`, `closeRedis()`
- **Redis client**: `new Redis(process.env.REDIS_URL || 'redis://localhost:6379')`
- **Events**: `connect`/`error`/`close`/`reconnecting` — log state transitions
- **Circuit breaker**: Track connection state; when `error` or `close` fires, set `available = false`; on `connect` or `ready`, set `available = true`
- **Fallback**: Simple in-memory `Map` with TTL cleanup (for development without Redis)
- **Prefix**: `getPrefixedKey(namespace, key)` → `{namespace}:{key}`

#### `backend/src/middleware/auth.js` (MODIFY)
- **Rate limiter factory** (`rateLimiter(windowMs, max)`):
  - Remove `const rateLimits = new Map()` from factory closure
  - Use Lua script via `redis.eval()` for atomic sliding window
  - Fallback: if Redis unavailable, use in-memory `Map` with same TTL behavior
  - Return same interface: `(req, res, next)` → check → `res.status(429)` or `next()`
- **Lockout functions**:
  - `checkAccountLockout(ip)`: `GET lockout:{ip}` → parse JSON → check `lockedUntil > now`
  - `recordFailedAttempt(ip)`: `GET lockout:{ip}` → increment count → `SET lockout:{ip} JSON TTL`
  - `clearFailedAttempts(ip)`: `DEL lockout:{ip}`
  - **Fallback**: If Redis unavailable, fall back to existing `failedAttempts` Map
- **Imports needed**: `const { getRedis, isRedisAvailable } = require('../utils/redis')`

#### `backend/src/services/PermissionService.js` (MODIFY)
- **Cache get**: `GET permcache:{role}` → parse JSON → return array
- **Cache set**: `SETEX permcache:{role} 60 (serialized JSON)`
- **`invalidateRoleCache(role)`**: `DEL permcache:{role}`
- **`invalidateAll()`**: Iterate known roles and delete each key (or use `SCAN 0 MATCH permcache:*`)
- **Remove**: `init()` pre-warm at require-time — no longer needed; cache will be lazy-populated
- **Fallback**: If Redis unavailable, skip caching and always query DB

#### `backend/src/services/UserService.js` (MODIFY)
- **Add calls**: After any role/permission mutation (update user role, grant/revoke permission):
  ```javascript
  const PermissionService = require('./PermissionService');
  await PermissionService.invalidateRoleCache(newRole);
  await PermissionService.invalidateRoleCache(oldRole); // if changed
  ```

#### `backend/docker-compose.yml` (MODIFY)
- **Add service**:
  ```yaml
  redis:
    image: redis:7-alpine
    container_name: vibecode-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
  ```
- **Add depends_on**: `api` service depends on `redis` condition `service_healthy`

#### `backend/src/utils/shutdown.js` (MODIFY)
- **Add**: `const { closeRedis } = require('./redis')`
- **Add to cleanup hooks**: `() => closeRedis()`

#### `backend/.env.example` (MODIFY)
- **Add**: `REDIS_URL=redis://localhost:6379`

#### Test files
##### `backend/src/__tests__/redis.test.js` (CREATE)
- Test: Redis connection success
- Test: Redis connection failure → fallback mode
- Test: Redis reconnection after failure
- Test: `getPrefixedKey` format

##### `backend/src/__tests__/rateLimiter.test.js` (EXTEND)
- Test: sliding window allows requests under limit
- Test: sliding window blocks requests over limit
- Test: TTL expiry resets the window
- Test: Redis unavailable → in-memory fallback works
- Test: multiple unique IPs tracked independently

##### `backend/src/__tests__/auth.test.js` (EXTEND)
- Test: lockout tracking across multiple attempts
- Test: lockout expiry after TTL
- Test: Redis unavailable → in-memory fallback for lockout
- Test: `clearFailedAttempts` works with Redis

##### `backend/src/__tests__/permissionService.test.js` (EXTEND)
- Test: permission cache is populated from DB on first request
- Test: cached permissions are returned within TTL
- Test: `invalidateRoleCache` clears cache and next fetch hits DB
- Test: TTL expiry triggers fresh DB fetch

---

### d) Dependencies

- `ioredis: ^5.4.1` — Redis client
- Docker Compose `redis` service — for local development and integration tests
- GitHub Actions Redis service — for CI integration tests

---

### e) Risks/Edge Cases

- **[Redis SPOF]**: Circuit-breaker fallback ensures the app never crashes due to Redis unavailability. Rate limiting degrades to per-instance effectiveness but does not block legitimate traffic.
- **[Atomicity]**: The Lua script ensures atomic rate limit check + increment. No race conditions.
- **[Key cleanup]**: All Redis keys have TTL. The `ZREMRANGEBYSCORE` in the Lua script also cleans up old entries before counting.

---

### f) Testing

#### Backend Unit Tests
- [ ] Test Redis utility module: `backend/src/__tests__/redis.test.js` — CREATED
- [ ] Test rate limiter: `backend/src/__tests__/rateLimiter.test.js` — EXTENDED
- [ ] Test lockout tracking: `backend/src/__tests__/auth.test.js` — EXTENDED
- [ ] Test permission cache: `backend/src/__tests__/permissionService.test.js` — EXTENDED
- [ ] Every new method has at least one test case
- [ ] Happy path AND fallback paths tested (Redis unavailable)

#### Backend Integration Tests
- [ ] Rate limit persists across multiple simulated instances
- [ ] Lockout persists across multiple simulated instances
- [ ] Permission cache invalidates on role change

---

### g) Migration Notes

No database migrations. Redis is a new infrastructure dependency.

---

### h) Files Changed

**Backend:**
```
backend/package.json                              → MODIFY (add ioredis)
backend/src/utils/redis.js                        → CREATE (Redis connection + fallback)
backend/src/middleware/auth.js                     → MODIFY (Redis-backed rate limiter + lockout)
backend/src/services/PermissionService.js          → MODIFY (Redis-backed cache)
backend/src/services/UserService.js                → MODIFY (cache invalidation hooks)
backend/src/utils/shutdown.js                      → MODIFY (redis.quit())
backend/src/utils/envValidation.js                 → MODIFY (REDIS_URL validation)
backend/.env.example                               → MODIFY (add REDIS_URL)
docker-compose.yml                                 → MODIFY (add redis service)
backend/src/__tests__/redis.test.js                → CREATE
backend/src/__tests__/rateLimiter.test.js          → EXTEND
backend/src/__tests__/auth.test.js                 → EXTEND
backend/src/__tests__/permissionService.test.js    → EXTEND
.github/workflows/ci.yml                           → MODIFY (add Redis service)
```

---

### i) Code Review Checklist

- [ ] Lua script is tested for edge cases (empty set, high cardinality, concurrent calls)
- [ ] Fallback path works when Redis is unavailable — no uncaught promise rejections
- [ ] All Redis keys have TTL — no unbounded growth
- [ ] Graceful shutdown disconnects Redis before pool close
- [ ] Circuit breaker switches back to Redis when connection is restored
- [ ] Permission cache invalidation is called from all role/permission mutation points
- [ ] `REDIS_URL` env var is validated at startup in production
- [ ] All tests pass

---

### j) Post-Deploy Verification

1. [ ] `npm test` — backend unit tests pass
2. [ ] `npm run test:integration` — integration tests pass (with Redis)
3. [ ] `npm run lint` — no lint errors
4. [ ] `curl http://localhost:3001/api/health` returns 200
5. [ ] `curl -X POST http://localhost:3001/api/auth/login` with bad credentials 5+ times → 429
6. [ ] Stop Redis container → requests still work (fallback mode)
7. [ ] Start Redis container → requests switch back to Redis mode
8. [ ] Role change on user → permission cache invalidated on next request
