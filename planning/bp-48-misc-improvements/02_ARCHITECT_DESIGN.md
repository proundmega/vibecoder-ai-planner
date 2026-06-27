# bp-48: Miscellaneous Infrastructure Improvements — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend, Frontend, DevOps

## Current State

### 1. Unused axios dependency
- `backend/package.json:18` — `axios: ^1.6.2`
- `frontend/package.json:21` — `axios: ^1.6.2`
- Backend usage: `backend/src/providers/generic/index.js` — 2 `axios.post()` calls (lines 15, 42)
- Frontend usage: ZERO — `frontend/src/api/client.js` uses native `fetch`

### 2. Auth response format
- Register (routes.js:188): `res.status(201).json({ ...result, message: 'Registration successful' })`
- Login (routes.js:244): `res.json({ message: 'Login successful', ...result })`
- Standard elsewhere: `{ success: true, data: ... }` (see routes.js:61, 105, 124, 145)

### 3. Pre-commit hooks
- No `.husky/` directory exists
- No `lint-staged` config in any package.json
- No root `package.json` either

### 4. Dependabot
- No `.github/` directory exists at all

### 5. DB backup
- Docker Compose volume `postgres_data` with no backup mechanism

### 6. Root Dockerfile
- `/Dockerfile` builds frontend from a root `package.json` that doesn't exist
- `docker-compose.yml` builds frontend via `frontend/Dockerfile`

## Proposed Solutions

### 1. Remove axios

**Backend**: Replace `GenericProvider`'s `axios.post()` with Node 18+ native `fetch`. The provider makes POST requests to OpenAI-compatible chat completions endpoints — straightforward JSON in/out.

**Frontend**: Simply remove `axios` from `dependencies`. No code changes needed since nothing imports it.

### 2. Fix auth response format

**Problem**: Two auth routes return bare objects instead of the standard wrapper.

**Standard wrapper** used by the rest of the API:
```json
{ "success": true, "data": { ... } }
```
or for errors:
```json
{ "success": false, "error": { "code": "...", "message": "..." } }
```

**Fix**: Wrap the register and login responses in `{ success: true, data: result, message: '...' }`.

**Note on `extractData`**: The frontend `client.js:41` strips `.data` if present (`data.data !== undefined ? data.data : data`). This is compatible with both old and new formats. After this change, `data.data` will be defined (the `{ token, user }` object), so the frontend will still receive the same shape.

### 3. Pre-commit hooks (husky + lint-staged)

**Approach**: Single root-level `.husky/` directory with a root `package.json` that contains:
- `devDependencies`: `husky`, `lint-staged`
- `lint-staged` config targeting both `frontend/` and `backend/`

**Pre-commit hook runs**:
```bash
npx --no-install lint-staged
```

**lint-staged config**:
```json
{
  "backend/src/**/*.js": ["eslint --fix"],
  "frontend/src/**/*.{js,ts,vue}": ["eslint --fix"],
  "frontend/src/**/*.ts": ["vue-tsc --noEmit"]
}
```

### 4. Dependabot config

Standard GitHub Dependabot YAML with two package ecosystems:
- `npm` for `backend/` and `frontend/` (weekly)
- `maven` for `agent/` (weekly)

### 5. DB backup script

Shell script at `scripts/backup-db.sh`:
```bash
docker exec -t vibecode-postgres pg_dumpall -c -U postgres > dump.sql
```

Restore documentation in script header comments.

### 6. Root Dockerfile removal

Delete `/Dockerfile`. The `frontend/Dockerfile` is already referenced by `docker-compose.yml`. The root `Dockerfile` fails on `COPY package*.json ./` + `npm ci` because there's no root `package.json`.

### Alternatives Considered

**Root Dockerfile → multi-stage build-all**: Possible but adds complexity. The existing `docker-compose.yml` already handles building all services. A root Dockerfile for "everything" would be duplicative and rarely used.

**node-fetch polyfill**: Unnecessary since the backend Docker image uses `node:18-alpine` which has native `fetch`.

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/package.json` | MODIFY | Remove `axios` from dependencies |
| `backend/src/providers/generic/index.js` | MODIFY | Replace `axios.post` with `fetch` |
| `backend/src/api/routes.js` | MODIFY | Wrap register + login in `{ success, data }` |
| `frontend/package.json` | MODIFY | Remove `axios` from dependencies |
| `/package.json` | CREATE | Root package.json with husky + lint-staged |
| `/.husky/pre-commit` | CREATE | Pre-commit hook delegating to lint-staged |
| `.github/dependabot.yml` | CREATE | Weekly npm + maven scanning |
| `scripts/backup-db.sh` | CREATE | pg_dumpall backup script |
| `/Dockerfile` | DELETE | Remove misleading root Dockerfile |
