# 03_ARCHITECT_IMPLEMENTATION.md — API Versioning

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-03-api-versioning

**Dependencies**: None

---

### a) Purpose

Add API versioning (`/api/v1/*`) to enable breaking changes without requiring coordinated frontend+backend updates.

**Value delivered**: Teams can evolve the API independently. Breaking changes get a deprecation period before removal.

---

### b) Actions

1. **Create version middleware** — `backend/src/middleware/apiVersion.js`
   - `apiVersion(version)` — sets `req.apiVersion`, adds deprecation headers

2. **Create versioned route structure** — `backend/src/api/v1/`
   - Move all route modules into `v1/` directory
   - `v1/index.js` — mounts all v1 route modules

3. **Update main router** — `backend/src/api/index.js`
   - Mount `/v1` with versioned routes
   - Add catch-all for unversioned requests (404 with suggestion)

4. **Update index.js** — `backend/src/index.js`
   - Mount versioned router at `/api`

5. **Update frontend**
   - `frontend/src/api/client.js` — change `API_BASE` to `/api/v1`
   - `frontend/vite.config.ts` — update proxy to `/api/v1`

6. **Update OpenAPI spec** — `backend/src/api/openapi-spec.js`
   - Update server URL to include `/v1` prefix

7. **Create tests**
   - `backend/src/__tests__/apiVersion.test.js` — version middleware tests

---

### c) Dependencies

- **Frontend**: `client.js` and `vite.config.ts` must update API_BASE

---

### d) Risks/Edge Cases

- **[Downtime during migration]**: All routes move at once. Mitigation: deploy backend and frontend together.
- **[OpenAPI spec]**: Spec must reflect `/v1/` prefix.
- **[Swagger UI]**: Must still work with versioned routes.

---

### e) Testing

#### Unit Tests
- [ ] apiVersion middleware sets req.apiVersion
- [ ] Deprecation header added for non-latest versions
- [ ] Unversioned requests return 404 with suggestion

#### Integration Tests
- [ ] GET /api/v1/users returns 200
- [ ] GET /api/users returns 404 with version suggestion
- [ ] Frontend can reach all endpoints via /api/v1

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` and `npm run build` to confirm tests pass

---

### g) Files Changed

- `backend/src/middleware/apiVersion.js` — NEW
- `backend/src/api/v1/index.js` — NEW
- `backend/src/api/v1/*.js` — NEW (all route modules moved)
- `backend/src/api/index.js` — CHANGED
- `backend/src/index.js` — CHANGED
- `backend/src/api/openapi-spec.js` — CHANGED
- `frontend/src/api/client.js` — CHANGED
- `frontend/vite.config.ts` — CHANGED
- `backend/src/__tests__/apiVersion.test.js` — NEW

---

### h) Code Review Checklist

- [ ] All existing routes are present under /api/v1/
- [ ] Unversioned /api/* returns 404 with helpful version suggestion
- [ ] Frontend API_BASE updated to /api/v1 consistently
- [ ] OpenAPI spec server URL includes /v1 prefix
- [ ] Swagger UI still accessible and functional
- [ ] Deprecation headers present on non-latest version responses
- [ ] No hardcoded /api/ paths remain in backend or frontend code

---

### i) Post-Deploy Verification

- [ ] All API endpoints accessible at /api/v1/*
- [ ] Unversioned /api/* returns 404 with version suggestion
- [ ] Frontend loads and all API calls succeed
- [ ] OpenAPI spec at /api/v1/openapi.json reflects correct paths
- [ ] Swagger UI at /api/v1/docs renders correctly
- [ ] Monitor error rate for 15 minutes — no unexpected 404s from frontend

---

### j) Migration Notes

None — pure code change. Deploy backend and frontend together.

---

### k) Notes

- URL path versioning: `/api/v1/*`
- Deprecation headers on non-latest versions
- Unversioned `/api/*` returns 404 with available versions list
- Frontend API_BASE must update to `/api/v1`

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, middleware, route structure*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
