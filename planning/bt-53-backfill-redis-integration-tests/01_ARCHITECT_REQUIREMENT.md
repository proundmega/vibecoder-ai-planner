# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Medium
**Related**: bp-53 (Distributed State)

---

## Requirement

bp-53 introduced Redis-based distributed state management including rate limiting, distributed locks, permission caching, and circuit-breaker fallback behavior. However, the testing coverage for these Redis-dependent features is incomplete — no integration tests verify multi-instance behavior, lockout persistence, cache invalidation, circuit-breaker fallback, or Lua script atomicity.

This ticket backfills all missing integration tests for the bp-53 Redis infrastructure changes.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [ ] API route exists: `backend/src/api/` — YES (rate limiting middleware, auth routes)
- [ ] Controller exists: `backend/src/controllers/` — YES (auth controllers)
- [ ] Service exists: `backend/src/services/` — YES (RateLimitService, PermissionCache, CircuitBreaker)
- [ ] Model exists: `backend/src/models/` — verify
- [ ] Validator exists: `backend/src/validators/` — verify
- [ ] Route is mounted: `backend/src/api/routes.js` — YES
- [ ] OpenAPI JSDoc annotations exist — verify

### Frontend API Client Check
- [ ] API client exists: `frontend/src/api/` — verify
- [ ] API client functions cover all needed endpoints — verify
- [ ] API client follows existing patterns — verify

### Frontend UI Check
- [ ] View component exists: `frontend/src/views/` — verify
- [ ] Component exists: `frontend/src/components/` — verify
- [ ] Route exists: `frontend/src/router/index.ts` — YES
- [ ] Existing tab/section where this can be added — N/A (backend-only changes)

### Integration Check
- [ ] Frontend API client can call existing backend endpoints — verify
- [ ] Response shapes match — verify
- [ ] Auth tokens are used correctly — verify
- [ ] Error handling matches existing patterns — verify

### Key Insight

This is a **backend test-only** ticket. All production code from bp-53 already exists. The task is to create integration tests that verify Redis-dependent behavior:
1. Rate limiting across multiple simulated instances
2. Lockout persistence after simulated instance restart
3. Permission cache invalidation on role change
4. Circuit-breaker fallback (Redis unavailable → in-memory)
5. Key expiry timing edge cases
6. Concurrent request handling at rate limit boundaries
7. Lua script atomicity

---

## Scope

### In Scope
- Create `backend/src/__tests__/integration/rateLimitMultiInstance.test.js` — test rate limiting across simulated instances
- Create `backend/src/__tests__/integration/lockoutPersistence.test.js` — test lockout survives restart
- Create `backend/src/__tests__/integration/permissionCacheInvalidation.test.js` — test cache invalidation on role change
- Create `backend/src/__tests__/integration/circuitBreakerFallback.test.js` — test Redis unavailable → in-memory fallback
- Create `backend/src/__tests__/integration/keyExpiryTiming.test.js` — test key expiry edge cases
- Create `backend/src/__tests__/integration/concurrentRateLimit.test.js` — test concurrent requests at boundaries
- Create `backend/src/__tests__/integration/luaScriptAtomicity.test.js` — test Lua script atomicity
- Extend `backend/integration-test/suites/` with bash tests for rate limiting behavior

### Out of Scope
- Modifying any production code from bp-53
- Creating tests for unrelated Redis functionality
- Changes to Redis configuration itself

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/integration/rateLimitMultiInstance.test.js` | CREATE | Multi-instance rate limiting |
| `backend/src/__tests__/integration/lockoutPersistence.test.js` | CREATE | Lockout persistence |
| `backend/src/__tests__/integration/permissionCacheInvalidation.test.js` | CREATE | Cache invalidation |
| `backend/src/__tests__/integration/circuitBreakerFallback.test.js` | CREATE | Circuit breaker fallback |
| `backend/src/__tests__/integration/keyExpiryTiming.test.js` | CREATE | Key expiry timing |
| `backend/src/__tests__/integration/concurrentRateLimit.test.js` | CREATE | Concurrent requests |
| `backend/src/__tests__/integration/luaScriptAtomicity.test.js` | CREATE | Lua script atomicity |
| `backend/integration-test/suites/` | EXTEND | Add bash tests for rate limiting |

---

## Known Unknowns

Things that could change the approach if the answer is different from assumed:

1. **[Redis availability in test environment]**: Does the test setup include a Redis instance? Need to check `jest.integration.config.js` and `docker-compose.yml` for Redis service.
2. **[Circuit breaker implementation]**: Is the circuit breaker already implemented or is it part of the bp-53 changes? Need to verify `backend/src/services/` for CircuitBreaker.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] Multi-instance rate limit test verifies 3 simulated instances share the same rate limit counter
2. [ ] Lockout persistence test verifies lockout state survives simulated instance restart (same Redis key)
3. [ ] Permission cache invalidation test verifies cache is cleared when user role changes
4. [ ] Circuit breaker test verifies in-memory fallback when Redis connection fails
5. [ ] Key expiry timing test verifies keys expire within ±500ms of expected TTL
6. [ ] Concurrent rate limit test verifies exactly N requests pass within a time window (no race conditions)
7. [ ] Lua script atomicity test verifies atomic increment/decrement under concurrent access
8. [ ] `npm test` passes with no regressions
9. [ ] `npm run test:integration` passes with no regressions
10. [ ] `cd backend && bash integration-test/run.sh --only` passes

---

## Testing Checklist

### Backend Tests
- [ ] Integration test: `backend/src/__tests__/integration/rateLimitMultiInstance.test.js` — CREATED
  - 3 simulated instances, shared Redis, verify counter consistency
- [ ] Integration test: `backend/src/__tests__/integration/lockoutPersistence.test.js` — CREATED
  - Simulate restart, verify lockout key persists in Redis
- [ ] Integration test: `backend/src/__tests__/integration/permissionCacheInvalidation.test.js` — CREATED
  - Change user role, verify cache miss on next request
- [ ] Integration test: `backend/src/__tests__/integration/circuitBreakerFallback.test.js` — CREATED
  - Mock Redis failure, verify in-memory fallback is used
- [ ] Integration test: `backend/src/__tests__/integration/keyExpiryTiming.test.js` — CREATED
  - Set key with TTL, verify it expires within tolerance
- [ ] Integration test: `backend/src/__tests__/integration/concurrentRateLimit.test.js` — CREATED
  - Send 20 concurrent requests, verify exactly limit pass
- [ ] Integration test: `backend/src/__tests__/integration/luaScriptAtomicity.test.js` — CREATED
  - Send concurrent Lua script calls, verify no lost updates
- [ ] **Bash integration suite**: `backend/integration-test/suites/rateLimit.test.sh` — CREATED
  - Test rate limiting behavior via curl

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test Redis failures, timeouts, race conditions
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **Skipping the bash integration suite** — rate limiting changes need curl-based tests
- ❌ **No regression test** — every new test must verify the specific bp-53 behavior
- ❌ **Using mock Redis** — integration tests must use real Redis for accurate timing/concurrency behavior

---

*Fill in all sections before starting implementation.*
