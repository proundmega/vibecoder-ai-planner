# 01_ARCHITECT_REQUIREMENT.md — Security Hardening

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Both
**Priority**: P1
**Effort**: Medium

---

## Requirement

Fix security vulnerabilities across the stack including hardcoded secrets, missing input validation, exposed infrastructure ports, and insecure communication patterns.

### Issues Addressed

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | JWT secret hardcoded fallback in 3 separate files with same dev value | HIGH | `middleware/auth.js:6`, `auth.js:5`, `services/UserService.js:41` |
| 2 | Encryption key length never validated — `Buffer.from(key, 'hex')` silently truncates | HIGH | `utils/crypto.js:16,39` |
| 3 | JWT token sent in WebSocket URL query string | HIGH | `frontend/src/views/TerminalView.vue:32` |
| 4 | Hardcoded default secrets in `.env` and `docker-compose.yml` | HIGH | `.env`, `docker-compose.yml:32,74,92-93` |
| 5 | PostgreSQL port 5432 exposed to host (production) | HIGH | `docker-compose.yml:75-76` |
| 6 | pgAdmin exposed to host with default credentials | HIGH | `docker-compose.yml:85-95` |
| 7 | nginx configs missing security headers | MEDIUM | Root `nginx.conf`, `frontend/nginx.conf` |
| 8 | Webhook sender accepts HTTP URLs (plaintext payload) | MEDIUM | `services/DeployService.js:120` |

---

## Existing Infrastructure Audit

### Backend
- [x] JWT fallback secrets in `middleware/auth.js`, `auth.js`, `services/UserService.js` — all `'vibecode-dev-secret-do-not-use-in-production'`
- [x] `utils/crypto.js` reads `MASTER_KEY` from env but only checks truthiness, not 64-char hex format
- [x] `utils/envValidation.js` lists `JWT_SECRET` as required but logs warning instead of crashing
- [x] `DeployService._sendWebhook` uses protocol detection — HTTP results in plaintext transmission

### Frontend
- [x] `TerminalView.vue:32` — `?token=${getToken()}` passes JWT in URL query string

### Infrastructure
- [x] `docker-compose.yml:75-76` — `ports: "5432:5432"` exposes DB to host
- [x] `docker-compose.yml:85-95` — pgAdmin with `admin@vibecode.dev` and `PGADMIN_PASSWORD=changeme`
- [x] `docker-compose.yml:32` — `ENCRYPTION_KEY=0123456789abcdef...` hardcoded default
- [x] Root `nginx.conf` — no `server_tokens off`, no CSP, no X-Frame-Options
- [x] `frontend/nginx.conf` — has some headers but missing CSP and `server_tokens off`

### Key Insight
Mix of backend, frontend, and infrastructure changes. Each is independently deployable.

---

## Scope

### In Scope
**Backend:**
- Consolidate JWT secret to single source (`utils/jwt.js`) with no fallback default — crash on startup if missing
- Validate `MASTER_KEY` length (exactly 64 hex chars) at startup in `envValidation.js`
- Add HTTPS-only warning in `DeployService._sendWebhook` when URL uses HTTP
- Add `server_tokens: false` to helmet config in `index.js`

**Frontend:**
- Move JWT token from WebSocket URL query string to first WebSocket message (handshake)

**Infrastructure:**
- Remove PostgreSQL port mapping from production compose (or guard with profile)
- Remove pgAdmin port mapping from production compose (or guard with profile)
- Remove hardcoded `ENCRYPTION_KEY` default from compose — require env var
- Add security headers to both nginx configs (`server_tokens off`, CSP, X-Frame-Options, X-Content-Type-Options)

### Out of Scope
- Adding HTTPS termination (handled by reverse proxy in production)
- Full auth system rewrite
- Database encryption at rest
- Secrets management system (Vault, etc.) — env vars are sufficient

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/utils/jwt.js` | CREATE | Single source for JWT secret; crash if missing |
| `backend/src/middleware/auth.js` | MODIFY | Import JWT from `utils/jwt.js` |
| `backend/src/auth.js` | MODIFY | Import JWT from `utils/jwt.js` |
| `backend/src/services/UserService.js` | MODIFY | Import JWT from `utils/jwt.js` |
| `backend/src/utils/envValidation.js` | MODIFY | Validate MASTER_KEY length (64 hex chars); crash if JWT_SECRET missing |
| `backend/src/utils/crypto.js` | MODIFY | Remove inline MASTER_KEY default; rely on env validation |
| `backend/src/services/DeployService.js` | MODIFY | Add logger.warn for HTTP webhook URLs |
| `backend/src/index.js` | MODIFY | Add `server_tokens: false` to helmet config |
| `frontend/src/views/TerminalView.vue` | MODIFY | Send token in WebSocket message instead of URL query param |
| `frontend/nginx.conf` | MODIFY | Add security headers |
| `nginx.conf` (root) | MODIFY | Add security headers (if not deleted by bp-55) |
| `docker-compose.yml` | MODIFY | Remove/pgAdmin profile; remove PG public port; remove ENCRYPTION_KEY default |
| `docker-compose.override.yml` | MODIFY | Add PG port mapping for dev only |
| `.env` | MODIFY | Remove hardcoded secrets (keep placeholder template) |
| `backend/.env.example` | MODIFY | Add MASTER_KEY requirement doc |

---

## Known Unknowns

1. **[WebSocket auth alternative]**: The terminal WebSocket currently uses JWT in query string. The recommended alternative is sending the token as the first WebSocket message frame. Need to verify the backend WebSocket handler (`api/terminal.js`) supports this handshake pattern.

---

## Important Design Decisions

1. **Single JWT module**: Create `utils/jwt.js` that exports `getSecret()` and throws if `JWT_SECRET` is not set. All 3 consumers import from it. No fallback default — crash at startup.
2. **nginx security headers**: Add `add_header` directives for `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Content-Security-Policy` (matching backend's helmet config).
3. **pgAdmin profile**: Add `profiles: [dev]` to pgAdmin and PostgreSQL services so they only start in development. Port mappings remain for dev convenience but are not exposed in production.

---

## Acceptance Criteria

1. [ ] `JWT_SECRET` missing at startup → process exits with clear error message
2. [ ] `utils/jwt.js` is the single source of truth for JWT secret — no fallback in any other file
3. [ ] `MASTER_KEY` length < 64 hex chars at startup → process exits with clear error
4. [ ] JWT token not present in WebSocket URL query string during connection
5. [ ] pgAdmin and PostgreSQL ports not exposed to host when running with production profile
6. [ ] Both nginx configs have `server_tokens off` and security headers
7. [ ] HTTP webhook URLs trigger a warning log
8. [ ] `docker compose up` (without override) does not expose PostgreSQL or pgAdmin ports
9. [ ] `docker compose -f docker-compose.yml -f docker-compose.override.yml up` exposes ports for dev
10. [ ] All existing tests pass

---

## Out of Scope

- Full auth system rewrite
- TLS/HTTPS termination
- Secrets management system
- Database encryption at rest
