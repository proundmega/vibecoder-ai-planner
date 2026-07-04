# 03_ARCHITECT_IMPLEMENTATION.md — Security Hardening

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

---

### Implementation Order

1. **Create `utils/jwt.js`** — Single source for JWT secret; crash if missing
2. **Update 3 consumers** — `middleware/auth.js`, `auth.js`, `services/UserService.js` to import from `utils/jwt.js`
3. **Update `envValidation.js`** — Validate `ENCRYPTION_KEY` length (64 hex chars)
4. **Update `crypto.js`** — Remove inline fallback default; rely on env validation
5. **Update `index.js`** — Add `server_tokens: false` to helmet config
6. **Update `DeployService.js`** — Add HTTP webhook warning
7. **Update WebSocket auth** — Backend `api/terminal.js` message-based auth + frontend `TerminalView.vue`
8. **Update nginx configs** — Add security headers to both `nginx.conf` files
9. **Update docker-compose.yml** — pgAdmin profile, remove PG port, remove ENCRYPTION_KEY default
10. **Update docker-compose.override.yml** — Add PG port mapping for dev
11. **Update `.env`** — Remove hardcoded secrets

### Testing

- [ ] Backend starts successfully with `JWT_SECRET` set
- [ ] Backend exits with error without `JWT_SECRET`
- [ ] Backend exits with error with invalid `ENCRYPTION_KEY`
- [ ] Terminal WebSocket connects without token in URL
- [ ] `grep -r "vibecode-dev-secret" backend/src/` returns 0
- [ ] `docker compose up` (no override) doesn't expose PG/pgAdmin ports
- [ ] Both nginx configs have `server_tokens off`
