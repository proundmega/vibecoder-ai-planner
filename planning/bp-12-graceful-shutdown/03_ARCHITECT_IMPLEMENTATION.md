# 03_ARCHITECT_IMPLEMENTATION.md — Graceful Shutdown

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-12-graceful-shutdown

**Dependencies**: None

---

### a) Purpose

Handle SIGTERM/SIGINT signals gracefully: stop accepting requests, drain in-flight requests, close database connections, exit cleanly.

**Value delivered**: No dropped requests during deployments. Clean database connection teardown.

---

### b) Actions

1. **Create shutdown handler** — `backend/src/utils/shutdown.js`
   - Handle SIGTERM and SIGINT
   - Stop HTTP server
   - Close database pool
   - Force exit after 30s timeout

2. **Call on startup** — `backend/src/index.js`
   - Import and call `gracefulShutdown(server, pool)`

3. **Update docker-compose.yml**
   - Add `stop_grace_period: 35s` to api service

4. **Create tests**
   - `backend/src/__tests__/gracefulShutdown.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Long-running queries]**: Query takes >30s, shutdown times out. Increase timeout if needed.
- **[Multiple signals]**: SIGTERM then SIGKILL before timeout. Docker `stop_grace_period` handles this.

---

### e) Testing

#### Unit Tests
- [ ] SIGTERM triggers shutdown sequence
- [ ] HTTP server stops accepting new requests
- [ ] Database pool closes
- [ ] Exit code is 0 on clean shutdown
- [ ] Force exit after timeout

#### Integration Tests
- [ ] Docker `docker stop` triggers graceful shutdown
- [ ] In-flight requests complete before exit

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/utils/shutdown.js` — NEW
- `backend/src/index.js` — CHANGED
- `docker-compose.yml` — CHANGED
- `backend/src/__tests__/gracefulShutdown.test.js` — NEW

---

### h) Code Review Checklist

- [ ] SIGTERM handler stops accepting new requests immediately
- [ ] In-flight requests are allowed to complete (drain period)
- [ ] Database pool is closed gracefully (no abrupt disconnects)
- [ ] Force exit after 30s timeout prevents hanging process
- [ ] Exit code is 0 on clean shutdown, 1 on timeout
- [ ] Docker stop_grace_period (35s) is longer than shutdown timeout (30s)

---

### i) Post-Deploy Verification

- [ ] Run `docker compose up --build` and verify services start
- [ ] Run `docker compose down` and verify clean shutdown (exit code 0)
- [ ] Check logs for "Shutting down" and "Shutdown complete" messages
- [ ] Verify no database connection errors during shutdown
- [ ] Monitor for dropped requests during a rolling restart

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Signal handlers: SIGTERM, SIGINT
- Shutdown timeout: 30 seconds
- Docker stop_grace_period: 35 seconds
- Exit code 0 on clean shutdown, 1 on timeout

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, shutdown handler, Docker integration*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
