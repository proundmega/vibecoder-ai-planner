# bp-48: Miscellaneous Infrastructure Improvements

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend, Frontend, DevOps
**Priority**: P3
**Effort**: Small

## Problem Statement

The codebase has accumulated several small issues that degrade developer experience and operational safety:

1. **Unused axios dependency** — Both `backend/package.json` and `frontend/package.json` list `axios`. Frontend uses native `fetch` exclusively (`frontend/src/api/client.js`). Backend uses `axios` only in `backend/src/providers/generic/index.js` (2 calls), which can be replaced with Node.js 18+ native `fetch`. Unused deps bloat `node_modules` and CI install times.

2. **Auth response format inconsistency** — `POST /auth/register` (routes.js:188) returns `{ ...result, message: 'Registration successful' }` and `POST /auth/login` (routes.js:244) returns `{ message: 'Login successful', ...result }`. The rest of the API uses `{ success: true, data: ... }` or `{ success: false, error: { code, message } }`. The frontend `client.js:41` handles both (`data.data !== undefined ? data.data : data`) but contract tests expect consistent format.

3. **No pre-commit hooks** — No husky/lint-staged configuration exists anywhere in the repo. Developers can commit code that fails lint or type checking, causing CI failures on trivial issues.

4. **No Dependabot config** — No `.github/dependabot.yml`. Dependency vulnerabilities (`npm audit`, Maven CVEs) are not automatically tracked.

5. **No DB backup strategy** — Docker Compose has a `postgres_data` volume but no documented backup/restore procedure. Losing the volume means losing all data.

6. **Misleading root Dockerfile** — `/Dockerfile` at repo root builds the frontend (nginx serving Vue), duplicating `frontend/Dockerfile`. This confuses anyone who runs `docker build .` expecting a multi-service build.

## Scope

- **In scope**: Remove axios, fix auth format, add husky/lint-staged, add dependabot, add backup script, fix root Dockerfile
- **Out of scope**: Migrating other libraries to native fetch, adding CORS tests, database migration scripts, CI pipeline changes

## Acceptance Criteria

- [ ] `frontend/package.json` has `axios` removed; no frontend code imports it
- [ ] `backend/package.json` has `axios` removed; `GenericProvider` uses native `fetch`
- [ ] `POST /auth/register` returns `{ success: true, data: { token, user }, message: 'Registration successful' }`
- [ ] `POST /auth/login` returns `{ success: true, data: { token, user }, message: 'Login successful' }`
- [ ] Husky pre-commit hook runs `npm run lint` (both packages) + `npm run typecheck` (frontend)
- [ ] `.github/dependabot.yml` watches npm + maven deps weekly
- [ ] `scripts/backup-db.sh` exists, executable, documented
- [ ] Root `Dockerfile` is removed (frontend has its own `frontend/Dockerfile`)

## Decisions Required

1. **Backend axios replacement**: Use Node 18+ native `fetch` (no new dep needed) rather than `node-fetch` polyfill.

2. **Root Dockerfile disposition**: Remove it entirely. The `docker-compose.yml` already references `frontend/Dockerfile` directly. A root Dockerfile that builds only the frontend is misleading.

3. **Husky install approach**: Run `npx husky init` in both packages, with a `.husky` dir at root level (shared). Single root `.husky/pre-commit` that delegates to both packages.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/package.json` | MODIFY | Remove `axios`, add `lint-staged` devDep |
| `backend/src/providers/generic/index.js` | MODIFY | Replace `axios.post()` with `fetch()` |
| `frontend/package.json` | MODIFY | Remove `axios`, add `husky`, `lint-staged` devDeps |
| `frontend/eslint.config.js` | MODIFY | Add `lint-staged` config |
| `backend/src/api/routes.js` | MODIFY | Wrap register + login in standard format |
| `/Dockerfile` | DELETE | Remove misleading root Dockerfile |
| `.github/dependabot.yml` | CREATE | npm + maven schedule |
| `scripts/backup-db.sh` | CREATE | pg_dumpall script |
| `.husky/pre-commit` | CREATE | Shared pre-commit hook |
| `package.json` (root) | CREATE | Root package.json with `husky` and `lint-staged` config |

## Dependencies

- Node 18+ required for `fetch` in backend (already `node:18-alpine` in Dockerfile)

## Performance Considerations

- Removing axios shaves ~1.2 MB from frontend bundle and ~50 KB from backend `node_modules`
- Backup script is manual — no cron or scheduled job; performance impact is zero
