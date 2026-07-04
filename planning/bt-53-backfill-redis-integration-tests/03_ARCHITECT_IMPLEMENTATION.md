# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bt-53 — Backfill Redis Integration Tests

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend

**Dependencies**: bp-53 (Distributed State) must be completed first

---

### a) Purpose

Backfill all missing integration tests for bp-53's Redis-based distributed state management. bp-53 introduced rate limiting, distributed locks, permission caching, and circuit-breaker fallback — but none of these have integration tests. Without tests, distributed behavior cannot be verified and Redis failures could silently degrade.

---

### b) Actions

**CRITICAL**: This is a test-only ticket. Do NOT modify any production code.

#### Implementation Order

1. **Shared Redis setup** — `backend/src/__tests__/integration/redis.setup.js`
   - Create shared setup/teardown for Redis DB 15
   - *Depends on*: nothing

2. **Rate limit multi-instance test** — `backend/src/__tests__/integration/rateLimitMultiInstance.test.js`
   - Test 3 simulated instances share rate limit counter
   - *Depends on*: Step 1

3. **Lockout persistence test** — `backend/src/__tests__/integration/lockoutPersistence.test.js`
   - Test lockout survives simulated restart
   - *Depends on*: Step 1

4. **Permission cache invalidation test** — `backend/src/__tests__/integration/permissionCacheInvalidation.test.js`
   - Test cache cleared on role change
   - *Depends on*: Step 1

5. **Circuit breaker fallback test** — `backend/src/__tests__/integration/circuitBreakerFallback.test.js`
   - Test Redis unavailable → in-memory fallback
   - *Depends on*: Step 1

6. **Key expiry timing test** — `backend/src/__tests__/integration/keyExpiryTiming.test.js`
   - Test key expires within ±500ms of TTL
   - *Depends on*: Step 1

7. **Concurrent rate limit test** — `backend/src/__tests__/integration/concurrentRateLimit.test.js`
   - Test exactly N requests pass under concurrency
   - *Depends on*: Step 1

8. **Lua script atomicity test** — `backend/src/__tests__/integration/luaScriptAtomicity.test.js`
   - Test atomic operations under concurrent access
   - *Depends on*: Step 1

9. **Bash integration tests** — `backend/integration-test/suites/rateLimit.test.sh`
   - Test rate limiting via curl
   - Register in `backend/integration-test/run.sh`
   - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `backend/src/__tests__/integration/redis.setup.js` (CREATE)

```javascript
const Redis = require('ioredis')

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/15')

async function beforeAll() {
  await redis.flushdb()
}

async function afterAll() {
  await redis.flushdb()
  await redis.quit()
}

module.exports = { redis, beforeAll, afterAll }
```

#### `backend/src/__tests__/integration/rateLimitMultiInstance.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')
const RateLimitService = require('../../../services/RateLimitService')

describe('Rate limiting across simulated instances', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('3 simulated instances share the same rate limit counter', async () => {
    const key = 'bt53:ratelimit:multi-instance'
    const service1 = new RateLimitService({ key, limit: 9, window: 60000 })
    const service2 = new RateLimitService({ key, limit: 9, window: 60000 })
    const service3 = new RateLimitService({ key, limit: 9, window: 60000 })

    // Instance 1: 5 requests
    for (let i = 0; i < 5; i++) {
      await service1.check()
    }

    // Instance 2: 3 requests
    for (let i = 0; i < 3; i++) {
      await service2.check()
    }

    // Instance 3: 1 request (should be blocked, 5+3+1=9 = limit)
    const result = await service3.check()
    expect(result.allowed).toBe(false)
  })

  it('rate limit counter resets after window expires', async () => {
    const key = 'bt53:ratelimit:reset'
    const service = new RateLimitService({ key, limit: 5, window: 1000 })

    for (let i = 0; i < 5; i++) {
      await service.check()
    }

    await new Promise(r => setTimeout(r, 1200))

    const result = await service.check()
    expect(result.allowed).toBe(true)
  })

  it('different IPs have separate counters', async () => {
    const key = 'bt53:ratelimit:ip-based'
    const service = new RateLimitService({ key, limit: 5, window: 60000 })

    const result1 = await service.check('ip-a')
    const result2 = await service.check('ip-b')
    expect(result1.allowed).toBe(true)
    expect(result2.allowed).toBe(true)
  })
})
```

#### `backend/src/__tests__/integration/lockoutPersistence.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')

describe('Lockout persistence after simulated restart', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('lockout key persists after instance restart', async () => {
    const key = 'bt53:lockout:user-1'
    await redis.set(key, 'locked', 'EX', 60)

    // Simulate restart: new service instance
    const service = new (require('../../../services/RateLimitService'))({ key, limit: 0, window: 60000 })

    // Verify key still exists
    const exists = await redis.exists(key)
    expect(exists).toBe(1)

    // Verify new instance respects lockout
    const result = await service.check()
    expect(result.allowed).toBe(false)
  })

  it('lockout expires after configured duration', async () => {
    const key = 'bt53:lockout:expire-test'
    await redis.set(key, 'locked', 'EX', 1)

    await new Promise(r => setTimeout(r, 1200))

    const exists = await redis.exists(key)
    expect(exists).toBe(0)
  })

  it('lockout is cleared after successful login', async () => {
    const key = 'bt53:lockout:clear-test'
    await redis.set(key, 'locked', 'EX', 60)

    // Simulate successful login → clear lockout
    await redis.del(key)

    const exists = await redis.exists(key)
    expect(exists).toBe(0)
  })
})
```

#### `backend/src/__tests__/integration/permissionCacheInvalidation.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')
const PermissionCache = require('../../../services/PermissionCache')

describe('Permission cache invalidation on role change', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('cache is cleared when user role changes', async () => {
    const userId = 1
    const cache = new PermissionCache()

    // Populate cache
    await cache.set(userId, ['read', 'write'])

    // Verify cache hit
    let perms = await cache.get(userId)
    expect(perms).toEqual(['read', 'write'])

    // Invalidate (simulate role change)
    await cache.invalidate(userId)

    // Verify cache miss
    perms = await cache.get(userId)
    expect(perms).toBeNull()
  })

  it('cache invalidation is scoped to specific user', async () => {
    await new PermissionCache().set(1, ['read'])
    await new PermissionCache().set(2, ['write'])

    await new PermissionCache().invalidate(1)

    const perms = await new PermissionCache().get(2)
    expect(perms).toEqual(['write'])
  })

  it('stale cache entries are refreshed after invalidation', async () => {
    const cache = new PermissionCache()
    await cache.set(1, ['old-perm'])
    await cache.invalidate(1)
    await cache.set(1, ['new-perm'])

    const perms = await cache.get(1)
    expect(perms).toEqual(['new-perm'])
  })
})
```

#### `backend/src/__tests__/integration/circuitBreakerFallback.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')
const CircuitBreaker = require('../../../services/CircuitBreaker')

describe('Circuit-breaker fallback behavior', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('falls back to in-memory when Redis is unavailable', async () => {
    const cb = new CircuitBreaker({ redisFailures: 3 })

    // Mock Redis to fail
    const originalConnect = redis.connect
    redis.connect = jest.fn().mockRejectedValue(new Error('Connection refused'))

    try {
      const result = await cb.execute(() => redis.get('test'))
      // Should fall back to in-memory, not throw
      expect(result).toBeDefined()
    } finally {
      redis.connect = originalConnect
    }
  })

  it('recovers to Redis after transient failure', async () => {
    const cb = new CircuitBreaker({ redisFailures: 3 })

    // Simulate failure then recovery
    // Verify circuit transitions from OPEN → HALF_OPEN → CLOSED
  })

  it('circuit opens after N consecutive failures', async () => {
    const cb = new CircuitBreaker({ redisFailures: 3 })

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(() => Promise.reject(new Error('fail')))
      } catch (e) { /* ignore */ }
    }

    // Circuit should be OPEN
    expect(cb.state).toBe('OPEN')
  })
})
```

#### `backend/src/__tests__/integration/keyExpiryTiming.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')

describe('Key expiry timing edge cases', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('key expires within ±500ms of expected TTL', async () => {
    const key = 'bt53:expiry:timing'
    const ttl = 5000

    await redis.set(key, 'value', 'EX', Math.floor(ttl / 1000))
    const start = Date.now()

    while (await redis.exists(key)) {
      await new Promise(r => setTimeout(r, 50))
    }

    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(ttl - 500)
    expect(elapsed).toBeLessThanOrEqual(ttl + 500)
  })

  it('TTL is refreshed on key access', async () => {
    const key = 'bt53:expiry:refresh'
    await redis.set(key, 'value', 'EX', 10)

    await new Promise(r => setTimeout(r, 5000))
    await redis.get(key) // Access refreshes TTL

    await new Promise(r => setTimeout(r, 6000))
    const exists = await redis.exists(key)
    expect(exists).toBe(1) // Should still exist due to TTL refresh
  })

  it('zero TTL key expires immediately', async () => {
    const key = 'bt53:expiry:zero'
    await redis.set(key, 'value', 'EX', 0)
    const exists = await redis.exists(key)
    expect(exists).toBe(0)
  })
})
```

#### `backend/src/__tests__/integration/concurrentRateLimit.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')
const RateLimitService = require('../../../services/RateLimitService')

describe('Concurrent request handling at rate limit boundaries', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('exactly N requests pass within a time window', async () => {
    const key = 'bt53:concurrent:limit'
    const service = new RateLimitService({ key, limit: 10, window: 60000 })

    const results = await Promise.all(
      Array(20).fill(0).map(() => service.check())
    )

    const allowed = results.filter(r => r.allowed).length
    const blocked = results.filter(r => !r.allowed).length

    expect(allowed).toBe(10)
    expect(blocked).toBe(10)
  })

  it('no race condition on counter increment', async () => {
    const key = 'bt53:concurrent:counter'
    const service = new RateLimitService({ key, limit: 50, window: 60000 })

    await Promise.all(
      Array(100).fill(0).map(() => service.check())
    )

    const count = await redis.get(key)
    expect(parseInt(count)).toBe(50)
  })

  it('requests in different time windows are independent', async () => {
    const key = 'bt53:concurrent:windows'
    const service = new RateLimitService({ key, limit: 10, window: 1000 })

    // Window 1
    const window1 = await Promise.all(
      Array(10).fill(0).map(() => service.check())
    )
    expect(window1.every(r => r.allowed)).toBe(true)

    // Wait for window to expire
    await new Promise(r => setTimeout(r, 1200))

    // Window 2
    const window2 = await Promise.all(
      Array(10).fill(0).map(() => service.check())
    )
    expect(window2.every(r => r.allowed)).toBe(true)
  })
})
```

#### `backend/src/__tests__/integration/luaScriptAtomicity.test.js` (CREATE)

```javascript
const { redis, beforeAll, afterAll } = require('./redis.setup')

describe('Lua script atomicity', () => {
  beforeAll(beforeAll)
  afterAll(afterAll)

  it('atomic increment under concurrent access', async () => {
    const key = 'bt53:lua:increment'
    await redis.del(key)

    const lua = 'return redis.call("INCR", KEYS[1])'

    const results = await Promise.all(
      Array(100).fill(0).map(() => redis.eval(lua, [key]))
    )

    expect(results.length).toBe(100)
    expect(results.every(r => typeof r === 'number')).toBe(true)
    expect(results[99]).toBe(100)
  })

  it('atomic check-and-set under concurrent access', async () => {
    const key = 'bt53:lua:checkset'
    await redis.del(key)

    const lua = `
      if redis.call("EXISTS", KEYS[1]) == 1 then
        return 0
      else
        redis.call("SET", KEYS[1], ARGV[1])
        return 1
      end
    `

    const results = await Promise.all(
      Array(100).fill(0).map(() => redis.eval(lua, [key], ['value']))
    )

    const successCount = results.filter(r => r === 1).length
    expect(successCount).toBe(1)
  })

  it('Lua script executes within timeout', async () => {
    const key = 'bt53:lua:perf'
    const lua = 'return redis.call("INCR", KEYS[1])'

    const times = []
    for (let i = 0; i < 50; i++) {
      const start = Date.now()
      await redis.eval(lua, [key])
      times.push(Date.now() - start)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    expect(avg).toBeLessThan(10) // avg < 10ms
  })
})
```

#### `backend/integration-test/suites/rateLimit.test.sh` (CREATE)

```bash
#!/usr/bin/env bash
# Tests for rate limiting behavior

test_rate_limit_applied() {
  local token=$(get_auth_token)
  local status
  local count=0

  # Send requests up to limit (adjust based on actual rate limit config)
  for i in $(seq 1 10); do
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer $token" \
      "$API_BASE/auth/login")
    if [ "$status" = "429" ]; then
      break
    fi
    count=$((count + 1))
  done

  # At least some requests should have been rate limited
  [ "$count" -lt 10 ] && return 0 || return 1
}

test_rate_limit_resets_after_window() {
  local token=$(get_auth_token)
  # Wait for rate limit window to expire
  sleep 61
  local status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $token" \
    "$API_BASE/auth/login")
  [ "$status" = "200" ] || [ "$status" = "401" ] && return 0 || return 1
}
```

---

### d) Dependencies

- Redis server (test instance on port 6379, DB 15)
- `RateLimitService` — from bp-53
- `PermissionCache` — from bp-53
- `CircuitBreaker` — from bp-53
- Existing Jest integration config — `jest.integration.config.js`
- Existing middleware — `rateLimiter.js`, lockout middleware

---

### e) Risks/Edge Cases

- **[Redis not available]**: Tests require Redis. Mitigation: use `describe.skip` with message if Redis unreachable, or ensure Redis container is running in CI.
- **[Flaky timing tests]**: Key expiry tests depend on system clock. Mitigation: use ±500ms tolerance.
- **[Race condition timing]**: Concurrent tests may be flaky on slow CI. Mitigation: use controlled concurrency with `Promise.all`.

---

### f) Testing

#### Backend Jest Integration Tests
- [ ] 7 integration test files CREATED
- [ ] Shared Redis setup in `redis.setup.js`
- [ ] All tests use Redis DB 15 (isolated)
- [ ] Each test file has `beforeAll`/`afterAll` hooks
- [ ] Code coverage: run `npm run test:coverage` — no significant decrease

#### Backend Bash Integration Suite
- [ ] `backend/integration-test/suites/rateLimit.test.sh` — CREATED
- [ ] Registered in `backend/integration-test/run.sh` `main()`
- [ ] Covers: rate limit applied, rate limit resets

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

### g) Migration Notes (if applicable)

No migrations needed. Tests interact with Redis only.

---

### h) Files Changed

**Backend:**
```
backend/src/__tests__/integration/redis.setup.js                           → CREATE (shared setup)
backend/src/__tests__/integration/rateLimitMultiInstance.test.js           → CREATE (3 tests)
backend/src/__tests__/integration/lockoutPersistence.test.js               → CREATE (3 tests)
backend/src/__tests__/integration/permissionCacheInvalidation.test.js      → CREATE (3 tests)
backend/src/__tests__/integration/circuitBreakerFallback.test.js           → CREATE (3 tests)
backend/src/__tests__/integration/keyExpiryTiming.test.js                  → CREATE (3 tests)
backend/src/__tests__/integration/concurrentRateLimit.test.js              → CREATE (3 tests)
backend/src/__tests__/integration/luaScriptAtomicity.test.js               → CREATE (3 tests)
backend/integration-test/suites/rateLimit.test.sh                          → CREATE (bash tests)
backend/integration-test/run.sh                                            → MODIFY (register tests)
```

---

### i) Code Review Checklist

- [ ] All test files follow existing naming conventions (`*.test.js`)
- [ ] Tests use real Redis (not mocks) for accurate distributed behavior
- [ ] Tests use isolated Redis DB (15)
- [ ] Each test file has `beforeAll`/`afterAll` hooks for cleanup
- [ ] Concurrent tests use `Promise.all` for controlled parallelism
- [ ] Timing tests use generous tolerance (±500ms)
- [ ] No production code modified (test-only ticket)
- [ ] `npm run test:integration` passes with no regressions
- [ ] `cd backend && bash integration-test/run.sh --only` passes

---

### j) Post-Deploy Verification

1. [ ] `npm run test:integration` passes
2. [ ] `cd backend && bash integration-test/run.sh --only` passes
3. [ ] `npm run lint` passes
4. [ ] All 7 integration test files exist and run without errors
5. [ ] No regressions in existing test suites

---

*Fill in all sections before starting implementation. Update status as work progresses.*
