# 03_ARCHITECT_IMPLEMENTATION.md — CORS Validation

**Status**: planned
**Priority**: P1 (High)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-13-cors-validation

**Dependencies**: None

---

### a) Purpose

Configure CORS with explicit allowed origins to prevent unauthorized cross-origin requests.

**Value delivered**: Blocks requests from unknown origins. Prevents CSRF attacks via cross-origin requests.

---

### b) Actions

1. **Create CORS middleware** — `backend/src/middleware/cors.js`
   - `cors(allowedOrigins)` — validates origin header
   - Returns 403 for disallowed origins
   - Handles OPTIONS preflight requests

2. **Apply CORS middleware** — `backend/src/index.js`
   - Read `ALLOWED_ORIGINS` from env var
   - Apply CORS before all routes

3. **Update .env.example** — `backend/.env.example`
   - Add `ALLOWED_ORIGINS` with development and production values

4. **Create tests**
   - `backend/src/__tests__/corsValidation.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Wildcard origin]**: Never use `*` with credentials. Must specify exact origin.
- **[Subdomains]**: List all subdomains explicitly. `app.vibecode.ai` doesn't match `dev.app.vibecode.ai`.

---

### e) Testing

#### Unit Tests
- [ ] Requests from allowed origins succeed with CORS headers
- [ ] Requests from disallowed origins return 403
- [ ] OPTIONS preflight returns 204 with CORS headers
- [ ] CORS headers present on error responses

#### Integration Tests
- [ ] Frontend can make cross-origin requests to API
- [ ] Blocked origin cannot make requests

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — no schema changes, no data migration
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/middleware/cors.js` — NEW
- `backend/src/index.js` — CHANGED
- `backend/.env.example` — CHANGED
- `backend/src/__tests__/corsValidation.test.js` — NEW

---

### h) Code Review Checklist

- [ ] No wildcard (`*`) origin is used — only explicit origins
- [ ] `ALLOWED_ORIGINS` env var is comma-separated list of full origins
- [ ] Credentials (cookies, auth headers) work with allowed origins
- [ ] OPTIONS preflight returns 204 with correct CORS headers
- [ ] CORS headers present on error responses (4xx, 5xx)
- [ ] Development and production origins are clearly separated in env

---

### i) Post-Deploy Verification

- [ ] Frontend at allowed origin can access API
- [ ] Requests from blocked origins return 403
- [ ] CORS headers present on all API responses
- [ ] OPTIONS preflight returns 204 with Access-Control-Allow-Origin header
- [ ] No CORS errors in browser console

---

### j) Migration Notes

None — pure code change. Update `ALLOWED_ORIGINS` in production.

---

### k) Notes

- Allowed origins from `ALLOWED_ORIGINS` env var (comma-separated)
- Development: `http://localhost:3000`
- Production: `https://app.vibecode.ai`
- Credentials allowed: true
- Preflight cached for 24 hours

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, CORS middleware, env config*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
