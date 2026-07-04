# 03_ARCHITECT_IMPLEMENTATION.md — Database Connection Pooling Configuration

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-02-db-pool-config

**Dependencies**: None

---

### a) Purpose

Explicitly configure pg.Pool with max connections, idle timeout, and connection timeout. Add pool stats to /metrics endpoint.

**Value delivered**: Prevents connection leaks, fails fast on pool exhaustion, provides observability.

---

### b) Actions

1. **Update db.js** — `backend/src/db.js`
   - Add explicit `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `maxUses`
   - Add `pool.on('error')` handler
   - Add `pool.stats()` method

2. **Update /metrics endpoint** — `backend/src/api/routes.js`
   - Add `database` object with pool stats
   - Include `status: 'healthy' | 'degraded'` based on idle count

3. **Update .env.example** — `backend/.env.example`
   - Add `DATABASE_POOL_MAX=20` comment

4. **Create tests**
   - `backend/src/__tests__/dbPool.test.js` — pool config tests

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Pool exhaustion]**: All connections in use → queries wait 5s then fail. Monitor /metrics.
- **[Connection leaks]**: Code using `pool.connect()` without `client.release()` fills pool. Audit all `pool.connect()` calls.
- **[Stale connections]**: DB restarts → connections die. `pool.on('error')` handler catches this.

---

### e) Testing

#### Unit Tests
- [ ] Pool has correct max, idleTimeout, connectionTimeout values
- [ ] Pool.stats() returns totalCount, idleCount, waitingCount
- [ ] Pool error handler logs error

#### Integration Tests
- [ ] /metrics endpoint includes database stats
- [ ] Pool rejects connection when exhausted (with clear error message)

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/db.js` — CHANGED
- `backend/src/api/routes.js` — CHANGED
- `backend/.env.example` — CHANGED
- `backend/src/__tests__/dbPool.test.js` — NEW

---

### h) Code Review Checklist

- [ ] Pool max connections (20) is appropriate for expected load
- [ ] Idle timeout (30s) balances connection reuse and resource cleanup
- [ ] Connection timeout (5s) fails fast without hanging requests
- [ ] pool.on('error') handler does not crash the process
- [ ] /metrics database stats include all relevant fields
- [ ] No connection leaks — all `pool.connect()` callers use try/finally with `client.release()`

---

### i) Post-Deploy Verification

- [ ] Check /metrics endpoint shows pool stats
- [ ] Monitor error rate for 15 minutes
- [ ] Verify pool idle count stays below max (no connection leaks)
- [ ] Confirm no "too many connections" errors in logs
- [ ] Test a database query to confirm pool is functioning

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Default max: 20 (configurable via DATABASE_POOL_MAX env var)
- Idle timeout: 30s — releases idle connections back to OS
- Connection timeout: 5s — fails fast instead of hanging
- Pool recycling: 10k uses per connection — prevents stale connection issues
- Pool stats exposed on /metrics for monitoring

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, pool config, metrics endpoint*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
