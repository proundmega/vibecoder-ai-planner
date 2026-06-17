# 03_ARCHITECT_IMPLEMENTATION.md — Docker Health Checks

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-08-docker-healthchecks

**Dependencies**: None

---

### a) Purpose

Add Docker health checks to all services for automatic restart on failure and proper startup ordering.

**Value delivered**: Failed containers restart automatically. Services start in correct order.

---

### b) Actions

1. **Verify /health endpoint** — `backend/src/index.js`
   - Ensure `GET /health` returns `{"success": true, "data": {"status": "ok"}}`

2. **Update docker-compose.yml**
   - Add `healthcheck` to `api`, `frontend`, `db` services
   - Update `depends_on` to use `condition: service_healthy`

3. **Update Dockerfiles**
   - Install `curl` in `backend/Dockerfile` (for health check)

4. **Create tests**
   - `backend/src/__tests__/healthCheck.test.js` — /health endpoint tests

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[curl not installed]**: Alpine images don't include curl. Install in Dockerfile.
- **[Health check loop]**: If /health checks DB and DB is down, container restarts. Keep /health simple.

---

### e) Testing

#### Unit Tests
- [ ] GET /health returns 200 with correct structure

#### Integration Tests
- [ ] Docker health checks pass after startup
- [ ] Containers restart on health check failure
- [ ] Startup order respects health checks

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `docker compose up --build` to confirm services start

---

### g) Files Changed

- `backend/src/index.js` — CHANGED
- `docker-compose.yml` — CHANGED
- `backend/Dockerfile` — CHANGED
- `frontend/Dockerfile` — CHANGED (if health check added)
- `db/Dockerfile` — CHANGED (if health check added)
- `backend/src/__tests__/healthCheck.test.js` — NEW

---

### h) Code Review Checklist

- [ ] /health endpoint returns minimal response (no DB dependency for api service)
- [ ] Health check interval (10s) and timeout (5s) are reasonable
- [ ] Start period allows warmup (10s api, 5s frontend, 5s db)
- [ ] Retries are appropriate (3 api/frontend, 5 db)
- [ ] curl is installed in backend Dockerfile
- [ ] depends_on uses `condition: service_healthy` for correct startup order

---

### i) Post-Deploy Verification

- [ ] Run `docker compose up --build` and verify all containers reach healthy state
- [ ] Check `docker compose ps` shows all services healthy
- [ ] Verify startup order: db → migrate → api → frontend
- [ ] Simulate failure: stop db container, verify api container restarts after health check fails
- [ ] Monitor logs for health check errors during first 15 minutes

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Health check interval: 10s
- Health check timeout: 5s
- Start period: 10s (api), 5s (frontend), 5s (db)
- Retries: 3 (api/frontend), 5 (db)

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, healthcheck config, startup order*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
