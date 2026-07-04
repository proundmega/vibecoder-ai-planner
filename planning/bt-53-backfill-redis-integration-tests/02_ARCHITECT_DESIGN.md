# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-53 (Distributed State)

---

## Problem Statement

bp-53 introduced Redis-based distributed state management (rate limiting, distributed locks, permission caching, circuit-breaker fallback) but added no integration tests. Without tests, distributed behavior (multi-instance consistency, lockout persistence, cache invalidation) cannot be verified, and Redis failures could silently degrade to incorrect in-memory behavior.

---

## Current State

### Existing Backend
- `RateLimitService` — Redis-based rate limiter with sliding window
- `PermissionCache` — Redis-based permission cache with TTL
- `CircuitBreaker` — Fallback from Redis to in-memory on failure
- Distributed lock via Redis `SETNX` with Lua scripts for atomicity
- Rate limit middleware: `backend/src/middleware/rateLimiter.js`
- Lockout middleware: `backend/src/middleware/` (login lockout)

### Existing Frontend
- No frontend changes from bp-53 (backend-only)

### Gap Analysis
- **No integration tests** for any Redis-dependent behavior
- **No tests** for multi-instance consistency
- **No tests** for circuit-breaker fallback
- **No tests** for Lua script atomicity
- **No tests** for key expiry timing
- **No tests** for concurrent request handling
- **No tests** for cache invalidation

---

## Design

### Test Architecture

All tests use **real Redis** (not mocks) via `ioredis` or `redis` package in integration tests. The test setup starts a Redis container or uses a test Redis instance.

#### Test Infrastructure

```javascript
// backend/src/__tests__/integration/redis.setup.js
const Redis = require('ioredis')
let redis

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/15') // use DB 15 for tests
  await redis.flushdb()
})

afterAll(async () => {
  await redis.flushdb()
  await redis.quit()
})

module.exports = { redis }
```

#### Individual Test Files

All 7 integration test files follow this pattern:
1. Import shared Redis setup
2. Before each test: flush test keys
3. Test specific behavior
4. After each test: clean up test keys

### Test File Structure

#### `backend/src/__tests__/integration/rateLimitMultiInstance.test.js`

```javascript
const { redis } = require('./redis.setup')
const RateLimitService = require('../../../services/RateLimitService')

describe('Rate limiting across simulated instances', () => {
  it('3 simulated instances share the same rate limit counter', async () => {
    // Create 3 RateLimitService instances (different client IDs)
    // Instance 1: send 5 requests (below limit)
    // Instance 2: send 3 more requests
    // Instance 3: send 1 more request (should be blocked if limit=9)
    // Assert: Instance 3's request is rate limited
  })

  it('rate limit counter resets after window expires', async () => {
    // Set TTL to 1 second
    // Send requests up to limit
    // Wait 1.1 seconds
    // Send again — should succeed
  })

  it('different IPs have separate counters', async () => {
    // IP A: send 5 requests
    // IP B: send 5 requests (should not affect A's counter)
  })
})
```

#### `backend/src/__tests__/integration/lockoutPersistence.test.js`

```javascript
describe('Lockout persistence after simulated restart', () => {
  it('lockout key persists after instance restart', async () => {
    // Simulate login failure → lockout key created in Redis
    // Simulate instance restart (new RateLimitService instance)
    // Verify lockout key still exists in Redis
    // Verify new instance respects the lockout
  })

  it('lockout expires after configured duration', async () => {
    // Create lockout with 60s TTL
    // Wait 61 seconds
    // Verify lockout key is gone
  })

  it('lockout is cleared after successful login', async () => {
    // Create lockout
    // Simulate successful login → lockout cleared
    // Verify lockout key is deleted
  })
})
```

#### `backend/src/__tests__/integration/permissionCacheInvalidation.test.js`

```javascript
const PermissionCache = require('../../../services/PermissionCache')

describe('Permission cache invalidation on role change', () => {
  it('cache is cleared when user role changes', async () => {
    // Populate cache for user 1 (role: user)
    // Simulate role change to project_admin
    // Call PermissionCache.invalidate(userId)
    // Verify next get() returns fresh permissions
  })

  it('cache invalidation is scoped to specific user', async () => {
    // Populate cache for user 1 and user 2
    // Invalidate user 1 only
    // Verify user 2 cache is still valid
  })

  it('stale cache entries are refreshed after invalidation', async () => {
    // Populate cache with old permissions
    // Invalidate
    // Set new permissions in DB
    // Verify get() returns new permissions
  })
})
```

#### `backend/src/__tests__/integration/circuitBreakerFallback.test.js`

```javascript
const CircuitBreaker = require('../../../services/CircuitBreaker')

describe('Circuit-breaker fallback behavior', () => {
  it('falls back to in-memory when Redis is unavailable', async () => {
    // Mock Redis connection to fail
    // Call RateLimitService.check()
    // Verify in-memory fallback is used (no errors thrown)
    // Verify rate limiting still works (with in-memory store)
  })

  it('recovers to Redis after transient failure', async () => {
    // Simulate Redis failure → fallback to in-memory
    // Restore Redis connection
    // Verify next call uses Redis again
  })

  it('circuit opens after N consecutive failures', async () => {
    // Fail Redis 5 times consecutively
    // Verify circuit is OPEN (all requests go to in-memory)
    // Wait for half-open timeout
    // Verify circuit transitions to HALF_OPEN
  })
})
```

#### `backend/src/__tests__/integration/keyExpiryTiming.test.js`

```javascript
describe('Key expiry timing edge cases', () => {
  it('key expires within ±500ms of expected TTL', async () => {
    // Set key with TTL of 5000ms
    // Record start time
    // Poll key existence until it disappears
    // Record end time
    // Assert: elapsed time is between 4500ms and 5500ms
  })

  it('TTL is refreshed on key access (if using PSETEX pattern)', async () => {
    // Set key with TTL of 10000ms
    // Access key at 5000ms (should refresh TTL)
    // Wait until 12000ms from start
    // Verify key still exists
  })

  it('zero TTL key expires immediately', async () => {
    // Set key with TTL of 0
    // Verify key is gone immediately
  })
})
```

#### `backend/src/__tests__/integration/concurrentRateLimit.test.js`

```javascript
describe('Concurrent request handling at rate limit boundaries', () => {
  it('exactly N requests pass within a time window', async () => {
    // Set limit to 10 requests per 60s
    // Send 20 concurrent requests (Promise.all)
    // Count how many pass (status 200) vs. blocked (status 429)
    // Assert: exactly 10 pass, 10 are blocked
  })

  it('no race condition on counter increment', async () => {
    // Send 100 concurrent requests with limit of 50
    // After all complete, verify Redis counter is exactly 50 (not 49 or 51)
  })

  it('requests in different time windows are independent', async () => {
    // Window 1: send 10 requests (limit=10)
    // Wait for window to expire
    // Window 2: send 10 requests (should all succeed)
  })
})
```

#### `backend/src/__tests__/integration/luaScriptAtomicity.test.js`

```javascript
describe('Lua script atomicity', () => {
  it('atomic increment under concurrent access', async () => {
    // Lua script: INCR key
    // Send 100 concurrent INCR calls
    // Verify final value is exactly 100
  })

  it('atomic check-and-set under concurrent access', async () => {
    // Lua script: if EXISTS key then return 0 else SET key value; return 1 end
    // Send 100 concurrent calls
    // Verify exactly 1 succeeds, 99 fail
  })

  it('Lua script executes within timeout', async () => {
    // Measure execution time of Lua script under load
    // Assert: avg execution time < 10ms
  })
})
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/__tests__/integration/redis.setup.js` | CREATE | Shared Redis setup/teardown |
| `backend/src/__tests__/integration/rateLimitMultiInstance.test.js` | CREATE | 3 test cases |
| `backend/src/__tests__/integration/lockoutPersistence.test.js` | CREATE | 3 test cases |
| `backend/src/__tests__/integration/permissionCacheInvalidation.test.js` | CREATE | 3 test cases |
| `backend/src/__tests__/integration/circuitBreakerFallback.test.js` | CREATE | 3 test cases |
| `backend/src/__tests__/integration/keyExpiryTiming.test.js` | CREATE | 3 test cases |
| `backend/src/__tests__/integration/concurrentRateLimit.test.js` | CREATE | 3 test cases |
| `backend/src/__tests__/integration/luaScriptAtomicity.test.js` | CREATE | 3 test cases |
| `backend/integration-test/suites/rateLimit.test.sh` | CREATE | Bash tests for rate limiting |
| `backend/integration-test/run.sh` | MODIFY | Register new test functions |

---

## Data Flow Diagram

```
[Test] → [create Redis client] → [call RateLimitService] → [Redis GET/INCR] → [assert count]
[Test] → [create Redis client] → [call PermissionCache] → [Redis GET/SET/DEL] → [assert cache state]
[Test] → [mock Redis failure] → [call CircuitBreaker] → [in-memory store] → [assert fallback behavior]
[Test] → [send concurrent requests] → [RateLimitService] → [Redis + Lua script] → [assert atomicity]
```

---

## Dependencies

### Backend Dependencies
- Redis server (test instance on port 6379/DB 15)
- `RateLimitService` — from bp-53
- `PermissionCache` — from bp-53
- `CircuitBreaker` — from bp-53
- Existing Jest integration config — `jest.integration.config.js`
- Existing middleware — `rateLimiter.js`, lockout middleware

### Cross-Cutting Dependencies
- Redis must be running for integration tests
- `ioredis` or `redis` package for test Redis client

---

## Config / Environment Changes
- No new environment variables needed
- No new npm dependencies needed (use existing Redis client)
- Test Redis DB: use `/15` to avoid conflicts with production

---

## Database Changes
No database changes. All tests use Redis.

---

## Security Considerations
- Integration tests use isolated Redis DB (15) to avoid polluting test data
- No real user data in tests — all test data is ephemeral
- Circuit breaker tests mock Redis failures (no security impact)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend integration | Jest + real Redis | `backend/src/__tests__/integration/*.test.js` | Multi-instance consistency, race conditions, fallback behavior |
| **Bash integration** | curl | `backend/integration-test/suites/rateLimit.test.sh` | Real API rate limiting in Docker environment |

### Redis Test Setup

```javascript
// Use Redis DB 15 (isolated from production DB 0)
const redis = new Redis('redis://localhost:6379/15')

// Flush before/after each test suite
beforeAll(async () => await redis.flushdb())
afterAll(async () => {
  await redis.flushdb()
  await redis.quit()
})
```

---

## Risks and Edge Cases

### Backend Risks
- **[Redis not available]**: Tests require Redis. Mitigation: skip tests with `describe.skip` if Redis is unreachable, or start Redis via Docker in test setup.
- **[Flaky timing tests]**: Key expiry tests depend on system clock. Mitigation: use ±500ms tolerance.
- **[Race condition timing]**: Concurrent tests may be flaky on slow CI. Mitigation: use `Promise.all` with controlled concurrency, add retry logic.

### Integration Risks
- **[Test isolation]**: Redis DB 15 must be flushed between suites. Mitigation: `beforeAll`/`afterAll` hooks in shared setup file.
- **[Test ordering]**: Some tests may affect shared state. Mitigation: each test file uses its own key prefix (e.g., `bt53:ratelimit:*`, `bt53:lockout:*`).

### Edge Cases
- **[Redis OOM]**: Tests should not fill Redis memory. Mitigation: `flushdb` after each suite.
- **[Network partition]**: Circuit breaker tests simulate this by mocking Redis connection failures.
- **[Clock skew]**: Key expiry tests use generous tolerance (±500ms).

---

## Alternative Designs Considered

### Alternative 1: Mock Redis entirely
- **Pros**: No external dependency, faster tests
- **Cons**: Cannot verify actual Redis behavior (Lua atomicity, TTL precision, connection handling)
- **Decision**: Real Redis is necessary for integration tests

### Alternative 2: Use Redis container in test setup
- **Pros**: Fully isolated test environment
- **Cons**: Slower startup, requires Docker-in-Docker
- **Decision**: Use existing Redis instance (or start one via Docker in CI)

---

## Specification Generation

All test expectations are specific (not "test it works" but "exactly 10 out of 20 concurrent requests pass").

---

*This design document guides implementation. All tests use real Redis for accurate distributed behavior verification.*
