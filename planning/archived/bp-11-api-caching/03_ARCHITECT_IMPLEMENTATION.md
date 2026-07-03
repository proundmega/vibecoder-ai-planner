# 03_ARCHITECT_IMPLEMENTATION.md — API Caching

**Status**: planned
**Priority**: P3 (Low)
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-11-api-caching

**Dependencies**: None

---

### a) Purpose

Add in-memory caching for read-only API endpoints to reduce database load and improve response times.

**Value delivered**: Faster responses for frequently accessed data. Reduced database load.

---

### b) Actions

1. **Create cache utility** — `backend/src/utils/cache.js`
   - In-memory Map with TTL support
   - `get()`, `set()`, `invalidate()`, `clear()` methods

2. **Create cache middleware** — `backend/src/middleware/cache.js`
   - `cacheResponse(ttlMs)` — caches GET responses
   - Adds `Cache-Control` header

3. **Apply caching to GET endpoints**
   - Tickets: 60s TTL
   - Projects: 300s TTL
   - Users: 600s TTL

4. **Add cache invalidation** to mutation handlers
   - Invalidate relevant caches on POST/PUT/DELETE

5. **Create tests**
   - `backend/src/__tests__/apiCache.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Memory leaks]**: Cache grows unbounded. Implement LRU eviction or max size.
- **[Stale data]**: Short TTLs minimize stale data risk.
- **[Multi-instance]**: In-memory cache doesn't work across instances. Use Redis for production.

---

### e) Testing

#### Unit Tests
- [ ] Cache returns cached response when available
- [ ] Cache expires after TTL
- [ ] Cache invalidation works
- [ ] Cache-Control header present

#### Integration Tests
- [ ] GET /api/tickets returns cached response
- [ ] POST /api/tickets invalidates cache
- [ ] Cache TTL expires correctly

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/utils/cache.js` — NEW
- `backend/src/middleware/cache.js` — NEW
- `backend/src/api/tickets.js` — CHANGED
- `backend/src/api/projects.js` — CHANGED
- `backend/src/api/users.js` — CHANGED
- `backend/src/controllers/ticketController.js` — CHANGED (cache invalidation)
- `backend/src/controllers/projectController.js` — CHANGED (cache invalidation)
- `backend/src/controllers/userController.js` — CHANGED (cache invalidation)
- `backend/src/__tests__/apiCache.test.js` — NEW

---

### h) Code Review Checklist

- [ ] Cache has max size or LRU eviction to prevent memory leaks
- [ ] TTL values are appropriate per resource (tickets 60s, projects 300s, users 600s)
- [ ] Cache invalidation covers all mutation endpoints (POST/PUT/DELETE)
- [ ] Cache-Control header includes correct max-age value
- [ ] Cached responses include ETag or Vary header for proxy compatibility
- [ ] Cache does not cache authenticated/user-specific responses

---

### i) Post-Deploy Verification

- [ ] Monitor cache hit rate — expect high hits for GET endpoints
- [ ] Verify cache invalidation works after mutations (POST/PUT/DELETE)
- [ ] Check memory usage stays stable (no cache growth)
- [ ] Monitor response times — expect improvement on cached endpoints
- [ ] Verify Cache-Control headers appear on cached responses

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- TTL: tickets 60s, projects 300s, users 600s
- Cache-Control header on all cached responses
- Invalidation on mutations (POST/PUT/DELETE)
- In-memory Map — upgrade to Redis for production

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, cache utility, middleware*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
