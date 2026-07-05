# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Frontend
**Priority**: P1
**Effort**: Medium
**Related**: bp-58 (Security Hardening)

---

## Requirement

bp-58 introduced security hardening measures including:
- `utils/jwt.js` crash-on-missing `JWT_SECRET`
- `MASTER_KEY` validation (64 hex chars check, crash on invalid)
- WebSocket handshake auth (token in first message vs. URL query string)
- nginx security headers (`server_tokens off`, CSP, X-Frame-Options, X-Content-Type-Options)
- Docker Compose profile behavior (dev vs. production port exposure)
- HTTP webhook URL warning in `DeployService`
- `envValidation.js` crash-on-missing `JWT_SECRET`
- pgAdmin only available with `dev` profile
- PostgreSQL port not exposed in production compose

However, none of these security measures have corresponding tests. Without tests, security regressions are impossible to detect.

This ticket backfills all missing test coverage for the bp-58 security hardening changes.

---

## Existing Infrastructure Audit

### Backend API Check
- [ ] `utils/jwt.js` exists — verify JWT_SECRET crash behavior
- [ ] `envValidation.js` exists — verify JWT_SECRET crash behavior
- [ ] `DeployService` exists — verify HTTP webhook warning
- [ ] Existing test patterns: `backend/src/__tests__/` — verify

### Frontend UI Check
- [ ] WebSocket auth — verify handshake in frontend
- [ ] Docker Compose profiles — verify in `docker-compose.yml`
- [ ] nginx config — verify security headers
- [ ] Existing test patterns: `frontend/src/__tests__/` — verify

### Key Insight

This is a **test-only** ticket. All production code from bp-58 already exists. The task is to create tests for:
1. `utils/jwt.js` crash-on-missing-JWT_SECRET behavior
2. `MASTER_KEY` validation (64 hex chars, crash on invalid)
3. WebSocket handshake auth (token in first message vs. URL query string)
4. WebSocket URL does NOT contain token during connection
5. nginx security headers (`server_tokens off`, CSP, X-Frame-Options, X-Content-Type-Options)
6. Docker Compose profile behavior (dev vs. production port exposure)
7. HTTP webhook URL warning in `DeployService`
8. `envValidation.js` crash-on-missing-JWT_SECRET
9. pgAdmin only available with `dev` profile
10. PostgreSQL port not exposed in production compose

---

## Scope

### In Scope
- Create `backend/src/__tests__/jwtSecretCrash.test.js` — test JWT_SECRET crash behavior
- Create `backend/src/__tests__/masterKeyValidation.test.js` — test MASTER_KEY validation
- Create `backend/src/__tests__/websocketAuth.test.js` — test WebSocket handshake auth
- Create `backend/src/__tests__/nginxSecurityHeaders.test.js` — test nginx security headers
- Create `backend/src/__tests__/dockerProfileBehavior.test.js` — test Docker Compose profiles
- Create `backend/src/__tests__/deployServiceWarning.test.js` — test HTTP webhook warning
- Create `backend/src/__tests__/envValidationCrash.test.js` — test envValidation crash
- Create `backend/src/__tests__/pgAdminDevProfile.test.js` — test pgAdmin dev-only
- Create `backend/src/__tests__/postgresPortExposure.test.js` — test PostgreSQL port not exposed

### Out of Scope
- Modifying any production code from bp-58
- Creating new security measures
- Changes to Docker Compose or nginx configurations

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/jwtSecretCrash.test.js` | CREATE | JWT_SECRET crash test |
| `backend/src/__tests__/masterKeyValidation.test.js` | CREATE | MASTER_KEY validation |
| `backend/src/__tests__/websocketAuth.test.js` | CREATE | WebSocket handshake auth |
| `backend/src/__tests__/nginxSecurityHeaders.test.js` | CREATE | nginx security headers |
| `backend/src/__tests__/dockerProfileBehavior.test.js` | CREATE | Docker Compose profiles |
| `backend/src/__tests__/deployServiceWarning.test.js` | CREATE | HTTP webhook warning |
| `backend/src/__tests__/envValidationCrash.test.js` | CREATE | envValidation crash |
| `backend/src/__tests__/pgAdminDevProfile.test.js` | CREATE | pgAdmin dev-only |
| `backend/src/__tests__/postgresPortExposure.test.js` | CREATE | PostgreSQL port exposure |

---

## Known Unknowns

1. **[JWT_SECRET env var]**: Exact env var name used in `utils/jwt.js`. Need to check.
2. **[MASTER_KEY format]**: Exact validation regex for 64 hex chars. Need to check.
3. **[WebSocket auth]**: Exact WebSocket endpoint and handshake protocol. Need to check.
4. **[nginx config path]**: Exact nginx config file path. Need to check.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] `utils/jwt.js` throws error when `JWT_SECRET` is not set
2. [ ] `MASTER_KEY` with invalid format (not 64 hex chars) throws error
3. [ ] `MASTER_KEY` with valid format (64 hex chars) does not throw
4. [ ] WebSocket handshake requires token in first message
5. [ ] WebSocket handshake rejects URL query string tokens
6. [ ] WebSocket URL does NOT contain token in connection string
7. [ ] nginx config has `server_tokens off`
8. [ ] nginx config has CSP header
9. [ ] nginx config has X-Frame-Options header
10. [ ] nginx config has X-Content-Type-Options header
11. [ ] Docker Compose `dev` profile exposes dev ports
12. [ ] Docker Compose `production` profile does NOT expose dev ports
13. [ ] `DeployService` warns when webhook URL uses HTTP
14. [ ] `envValidation.js` throws error when `JWT_SECRET` is not set
15. [ ] pgAdmin is only available with `dev` profile
16. [ ] PostgreSQL port is NOT exposed in production compose
17. [ ] `npm test` passes with no regressions
18. [ ] `npm run lint` passes

---

## Testing Checklist

### Backend Tests
- [ ] `backend/src/__tests__/jwtSecretCrash.test.js` — CREATED
- [ ] `backend/src/__tests__/masterKeyValidation.test.js` — CREATED
- [ ] `backend/src/__tests__/websocketAuth.test.js` — CREATED
- [ ] `backend/src/__tests__/nginxSecurityHeaders.test.js` — CREATED
- [ ] `backend/src/__tests__/dockerProfileBehavior.test.js` — CREATED
- [ ] `backend/src/__tests__/deployServiceWarning.test.js` — CREATED
- [ ] `backend/src/__tests__/envValidationCrash.test.js` — CREATED
- [ ] `backend/src/__tests__/pgAdminDevProfile.test.js` — CREATED
- [ ] `backend/src/__tests__/postgresPortExposure.test.js` — CREATED

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test security failures, edge cases
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-58 behavior
- ❌ **Skipping security tests** — security measures must be verified

---

*Fill in all sections before starting implementation.*
