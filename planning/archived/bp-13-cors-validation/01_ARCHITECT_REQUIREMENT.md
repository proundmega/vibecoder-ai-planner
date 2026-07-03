# 01_ARCHITECT_REQUIREMENT.md — CORS Validation

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

CORS must be configured with explicit allowed origins. Currently using permissive defaults or no CORS configuration.

---

## Scope

- Configure CORS with explicit `allowedOrigins` list
- Block requests from unknown origins
- Support preflight (OPTIONS) requests
- Add CORS headers to error responses

---

## Assumptions

- The `cors` package is NOT currently installed (confirmed by `backend/package.json` — no `cors` dependency)
- The frontend is served by nginx in production (same-origin API calls via proxy — no CORS needed in production)
- CORS is primarily needed for development (`localhost:3000` frontend calling `localhost:3001` API)
- The Java agent application does NOT use CORS (it runs server-side, no browser)
- `ALLOWED_ORIGINS` env var should support comma-separated values (e.g., `http://localhost:3000,https://app.vibecode.ai`)
- The Docker nginx proxy in production does NOT need CORS configuration (same-origin via `/api` proxy)

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **What origins are allowed?**
   - Development: `http://localhost:3000`
   - Staging: `https://staging.vibecode.ai`
   - Production: `https://app.vibecode.ai`
   - Or read from env var `ALLOWED_ORIGINS`?

2. **Should we use a library?**
   - `cors` package — battle-tested, simple
   - Custom middleware — no dependency, more control

3. **Should we allow credentials?**
   - Yes — `Access-Control-Allow-Credentials: true` (for cookies/auth)
   - No — simpler, but breaks auth flows

---

## Acceptance Criteria

- [ ] CORS is configured with an explicit list of allowed origins (from env var or hardcoded)
- [ ] Requests from allowed origins receive `Access-Control-Allow-Origin` header with the specific origin (not `*`)
- [ ] Requests from disallowed origins receive HTTP 403 with CORS error message
- [ ] OPTIONS preflight requests from allowed origins return 200 with appropriate CORS headers
- [ ] `Access-Control-Allow-Methods` includes `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- [ ] `Access-Control-Allow-Headers` includes `Content-Type, Authorization, X-API-Key`
- [ ] `Access-Control-Max-Age` is set on preflight responses (e.g., 86400 for 24 hours)
- [ ] CORS headers are present on error responses (not just 2xx responses)
- [ ] `cors` package is added as a dependency (if chosen)
- [ ] CORS is disabled or very permissive in development (or reads from `ALLOWED_ORIGINS`)
- [ ] Unit tests verify CORS behavior for allowed, disallowed, and preflight requests
- [ ] Linting passes with no errors

---

## Out of Scope

- CORS configuration for the frontend (frontend is served by nginx, same-origin in production)
- CORS for the Java agent application (no browser involved)
- CORS for file upload endpoints (not currently supported)
- CORS policy management UI (admin panel for managing allowed origins)
- CORS audit tooling or automated scanning
- CORS for WebSocket connections (not currently implemented)

---

## Testing Checklist

- [ ] Requests from allowed origins succeed
- [ ] Requests from disallowed origins return 403
- [ ] OPTIONS preflight requests succeed for allowed origins
- [ ] CORS headers present on error responses

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ `Access-Control-Allow-Origin: *` (allows any origin)
- ❌ Allowing `null` origin (can be used in XSS attacks)
- ❌ No CORS configuration (browser blocks requests)

---

*Ready for design phase.*
