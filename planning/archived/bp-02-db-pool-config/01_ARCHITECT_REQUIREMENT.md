# 01_ARCHITECT_REQUIREMENT.md — Database Connection Pooling Configuration

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

PostgreSQL connection pool must be explicitly configured with `max` connections, `idle timeout`, and `connection timeout`. Currently using defaults.

---

## Scope

- Configure `pg.Pool` with explicit `max` connections
- Set `idleTimeoutMillis` to release idle connections
- Set `connectionTimeoutMillis` to fail fast on pool exhaustion
- Add pool health monitoring
- Add pool stats to `/metrics` endpoint

---

## Assumptions

- `pg.Pool` is instantiated in `src/db.js` and exported for use throughout the application
- The project uses `pg` (node-postgres) package, not an ORM
- No PgBouncer or external connection pooler is currently in use
- The application is a single-node deployment (no distributed connection pool coordination needed)
- `DATABASE_URL` environment variable is already used for connection configuration
- Pool events (`acquire`, `remove`, `error`) are not currently being listened to

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **What should `max` connections be?**
   - Default pg.Pool max is 20 — is that enough for our workload?
   - Should it scale with available memory?
   - Should it be configurable via env var `DATABASE_POOL_MAX`?

2. **Should we use connection pooling proxy (PgBouncer)?**
   - Add PgBouncer as a Docker service
   - Or just configure pg.Pool properly for now?

3. **What idle timeout?**
   - Default 30 seconds — is that appropriate?
   - Should idle connections be closed sooner to save resources?

---

## Acceptance Criteria

- [ ] `pg.Pool` is configured with explicit `max`, `idleTimeoutMillis`, and `connectionTimeoutMillis` options
- [ ] `max` connections is configurable via `DATABASE_POOL_MAX` env var (default: 20)
- [ ] `idleTimeoutMillis` defaults to 30000ms and is configurable via `DATABASE_IDLE_TIMEOUT_MS`
- [ ] `connectionTimeoutMillis` defaults to 2000ms and is configurable via `DATABASE_CONNECTION_TIMEOUT_MS`
- [ ] Pool rejects connections when exhausted with a clear error message (not a generic timeout)
- [ ] Idle connections are released back to the pool and closed after the idle timeout
- [ ] Pool stats (total connections, idle connections, waiting requests) are accessible
- [ ] Pool exhaustion errors are caught and returned as HTTP 503 with clear message
- [ ] Unit tests verify pool configuration (mocked `pg.Pool`)
- [ ] Linting passes with no errors

---

## Out of Scope

- PgBouncer deployment (separate infrastructure decision)
- Connection pool metrics export to Prometheus/Grafana (can be added later)
- Connection pool recovery after database restart
- Per-route connection pool allocation
- Connection pool autoscaling based on load
- Read/write split or replica routing

---

## Testing Checklist

- [ ] Pool respects max connections limit
- [ ] Pool rejects connections when exhausted (with clear error)
- [ ] Idle connections are released back to pool
- [ ] Pool stats exposed on /metrics
- [ ] Connection timeout fails fast (not hanging)

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Using `pg.connect()` without returning connections
- ❌ Leaving pool at default max (20) without explicit config
- ❌ Not handling pool exhaustion errors

---

*Ready for design phase.*
