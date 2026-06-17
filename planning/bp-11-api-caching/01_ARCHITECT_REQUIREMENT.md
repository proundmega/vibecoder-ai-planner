# 01_ARCHITECT_REQUIREMENT.md — API Caching

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Read-only API endpoints should cache responses to reduce database load and improve response times.

---

## Scope

- Add in-memory cache for GET endpoints (tickets, projects, users)
- Cache invalidation on mutations (POST/PUT/DELETE)
- Support cache headers (Cache-Control, ETag)
- Configurable TTL per endpoint type

---

## Assumptions

- The application is single-node (no distributed cache coordination needed)
- `node-cache` or `memjs` is NOT currently a dependency (will need to be added, or use custom Map)
- In-memory cache data is lost on restart (acceptable for this use case)
- Cached responses should include standard HTTP cache headers (`Cache-Control`, `ETag`)
- Cache is per-endpoint group (tickets, projects, users) — not per individual resource ID initially
- The frontend does not currently set `Cache-Control` headers on API responses

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **What cache strategy?**
   - In-memory Map (simple, no dependency)
   - Redis (distributed, survives restarts)
   - HTTP caching only (Cache-Control headers, no server-side cache)

2. **What TTL?**
   - Tickets: 60 seconds
   - Projects: 300 seconds (5 minutes)
   - Users: 600 seconds (10 minutes)
   - Or something else?

3. **Should we use a library?**
   - `node-cache` — simple in-memory cache
   - `memjs` + Redis — distributed cache
   - Custom Map — no dependency, but no TTL support

---

## Acceptance Criteria

- [ ] GET endpoints for tickets, projects, and users return cached responses when available
- [ ] Cache TTL is configurable per endpoint type via environment variables (e.g., `CACHE_TICKETS_TTL=60`)
- [ ] Cache is invalidated when a mutation occurs (POST/PUT/DELETE on the same resource type)
- [ ] `Cache-Control` header is present on cached responses with correct TTL
- [ ] `ETag` header is present on cached responses for conditional requests (`If-None-Match`)
- [ ] 304 Not Modified is returned for conditional requests with matching ETag
- [ ] Cache does NOT apply to authenticated/user-specific responses (e.g., `GET /api/tickets/next` for agents)
- [ ] Cache size is bounded (max entries or max memory) to prevent unbounded growth
- [ ] Cache stats are accessible (hits, misses, size) — e.g., via `/metrics` or internal method
- [ ] Unit tests verify caching, invalidation, and TTL behavior
- [ ] Linting passes with no errors

---

## Out of Scope

- Redis deployment or configuration (if Redis strategy is NOT chosen)
- Cache warming on startup (pre-populate cache with frequently accessed data)
- Cache penetration protection (Bloom filters for non-existent keys)
- Cache stampede protection (single-flight for cache misses)
- CDN-level caching (CloudFront, Cloudflare — separate infrastructure)
- Cache invalidation via webhooks or event bus (in-memory invalidation is sufficient for single-node)
- Cache analytics dashboard (stats are sufficient)

---

## Testing Checklist

- [ ] GET endpoints return cached response when available
- [ ] Cache invalidates on mutation (POST/PUT/DELETE)
- [ ] Cache-Control headers present on responses
- [ ] Cache TTL expires correctly

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Caching mutable data without invalidation
- ❌ Caching user-specific data without per-user keys
- ❌ Caching for too long (stale data)

---

*Ready for design phase.*
