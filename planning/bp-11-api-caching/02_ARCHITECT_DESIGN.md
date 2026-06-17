# 02_ARCHITECT_DESIGN.md — API Caching

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

No caching on read endpoints. Every request hits the database, even for data that hasn't changed.

---

## Current State

```javascript
// Every GET request hits the database
router.get('/tickets', async (req, res) => {
  const tickets = await TicketService.getAll();  // Always DB query
});
```

---

## Design

### In-Memory Cache

```javascript
// backend/src/utils/cache.js
class Cache {
  constructor(maxSize = 1000) {
    this.store = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  invalidate(pattern) {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

module.exports = new Cache(1000);
```

### Cache Middleware

```javascript
// backend/src/middleware/cache.js
const cache = require('../utils/cache');

function cacheResponse(ttlMs = 60000) {
  return (req, res, next) => {
    // Skip cache for authenticated user-specific data
    if (req.user && (req.path.includes('/users') || req.path.includes('/me'))) {
      return next();
    }

    const key = `${req.method}:${req.path}:${JSON.stringify(req.query)}`;
    const cached = cache.get(key);
    
    if (cached) {
      res.set({
        'Cache-Control': `public, max-age=${ttlMs / 1000}`,
        'X-Cache': 'HIT',
      });
      return res.json(cached);
    }
    
    // Override res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && body.success && body.data !== undefined) {
        cache.set(key, body, ttlMs);
        res.set('X-Cache', 'MISS');
      }
      return originalJson(body);
    };
    
    next();
  };
}
```

### Cache Invalidation

```javascript
// In mutation handlers
cache.invalidate('/api/tickets');
cache.invalidate('/api/projects');
```

### TTL Configuration

```javascript
const CACHE_TTL = {
  tickets: 60000,      // 1 minute
  projects: 300000,    // 5 minutes
  users: 600000,       // 10 minutes
  default: 60000,      // 1 minute
};
```

### Alternative Designs Considered

- **Redis over in-memory** — Chose in-memory Map over Redis because: it adds zero infrastructure complexity and works well for single-instance deployments. Redis was considered but rejected because: it requires a Redis Docker service, adds network latency for every cache lookup, and complicates the deployment for a feature that can work locally.
- **HTTP-level caching (ETag/Last-Modified)** — Chose application-level caching over HTTP-level caching because: it provides more control over TTL per resource type and works behind reverse proxies that may not honor ETags. HTTP-level caching was considered but rejected because: it requires implementing ETag generation for every resource, handling conditional requests (`If-None-Match`), and may not work reliably with the SPA's API client.
- **Per-user caching** — Chose global cache with user-specific key exclusion over per-user caching because: most read endpoints (tickets list, projects list) return the same data for all users, so global caching reduces redundancy. Per-user caching was considered but rejected because: it would significantly increase cache size (N users × M resources) and the current auth model has limited user-specific GET endpoints.

### Data Flow Diagram

```
Client Request: GET /api/tickets
    ↓
[cacheResponse middleware]
    ↓
  [user-specific? → skip cache]
    ↓
  [build cache key: GET:/api/tickets:{}]
    ↓
  [cache.get(key)]
    ↓
  [hit?]
    ├─ Yes → 200 + X-Cache: HIT
    └─ No  → next()
                ↓
      [handler] → [service] → DB → response
                ↓
      [res.json() override] → cache.set(key, body, ttl)
                ↓
      200 + X-Cache: MISS
    ↓
POST /api/tickets (mutation)
    ↓
[handler] → [service] → DB → response
    ↓
cache.invalidate('/api/tickets') → remove all ticket cache entries
```

### Config / Env Changes

- NEW: `backend/src/utils/cache.js` — in-memory cache with LRU eviction and TTL
- NEW: `backend/src/middleware/cache.js` — cache response middleware
- NEW: `backend/.env.example` — add `CACHE_ENABLED=true`, `CACHE_TTL_TICKETS_MS=60000`, `CACHE_TTL_PROJECTS_MS=300000`, `CACHE_MAX_SIZE=1000`
- CHANGED: `backend/src/api/routes.js` — apply `cacheResponse()` to GET routes
- CHANGED: `backend/src/services/TicketService.js` — call `cache.invalidate('/api/tickets')` on mutations
- CHANGED: `backend/src/services/ProjectService.js` — call `cache.invalidate('/api/projects')` on mutations

---

## Dependencies

- **None** — pure JavaScript, no external dependencies

---

## Risks/Edge Cases

- **[Memory leaks]**: Cache grows unbounded. Mitigation: implement LRU eviction or max size limit.
- **[Stale data]**: Cache TTL may serve stale data. Mitigation: short TTLs, invalidation on mutations.
- **[User-specific data]**: Cache key must include user ID for user-specific responses.
- **[Multi-instance]**: In-memory cache doesn't work across multiple API instances. Use Redis for production.

---

*Ready for implementation phase.*
