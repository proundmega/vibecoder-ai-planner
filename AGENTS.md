# Vibecode AI Planner - Agent Guide

## Quick Start

```bash
# Required env vars
export JWT_SECRET="some-secret"
export POSTGRES_PASSWORD="some-password"

# Docker (all services)
docker compose up --build
# Without override: frontend on 3002 (nginx), with override: frontend on 3000 (vite)

# Manual
cd backend && npm run dev          # API on :3001
cd ../frontend && npm run dev      # Vite on :3000, proxies /api → :3001
```

## Structure

```
backend/src/
  index.js              → Express entry, exports app (for tests)
  api/routes.js         → All route mounting (/health, /auth, /projects, /tickets, /pricing, /agents)
  api/{projects,tickets,agents,pricing,user}.js  → route modules
  services/{Project,Ticket,Agent,User}Service.js  → business logic
  models/{user,project,ticket}.js  → DB models (raw pg queries)
  middleware/auth.js     → verifyToken, agentAuth, rateLimiter
  auth.js                → AuthService (register/login/token)
  db.js                  → pg Pool
  migrations/apply.js    → runs 001_create_tables.sql + 002_agents_schema.sql
frontend/src/
  router/index.ts        → nested routes, localStorage-based auth guard
  stores/auth.js         → Pinia store, tokens in localStorage (keys: vibecode_token, vibecode_user)
  views/{Login,Register,ProjectList,ProjectDetail,TicketBoard,TicketDetail,AIAssistant}.vue
```

## Commands

| Context | Command | What it does |
|---------|---------|-------------|
| Backend dev | `npm run dev` | `node --watch src/index.js` on :3001 |
| Backend test | `npm test` | Jest (see test quirks below) |
| Backend lint | `npm run lint` | `eslint src/` (flat config) |
| Backend migrate | `npm run db:migrate` | Run SQL migrations via apply.js |
| Frontend dev | `npm run dev` | Vite on :3000 |
| Frontend test | `npm test` | Vitest (no `--run` flag) |
| Frontend lint | `npm run lint` | `eslint src/` (flat config) |
| Frontend typecheck | `npm run typecheck` | `vue-tsc --noEmit` |
| Frontend build | `npm run build` | `vite build` → dist/ |

## CI (`.github/workflows/ci.yml`)

- **Backend**: lint → test → `node --check src/index.js` (syntax check, runs on ubuntu-latest with postgres:15 service)
- **Frontend**: lint → typecheck → build

## Test Quirks

- **Backend Jest** (`backend/jest.config.js`): all DB-dependent modules are fully mocked in `src/__tests__/jest.setup.js` — `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken` are replaced with mocks that return empty rows and fixed values. Tests do NOT need a real database.
- **Integration tests** (`npm run test:integration`): uses `jest.integration.config.js` which skips mocks and connects to real postgres via `DATABASE_URL`. Migrations run automatically via `src/__tests__/integration/setup.js`. Tests live in `src/__tests__/integration/docker.test.js`.
- **`src/__tests__/db.mocks.js`** provides alternate mocks (used by individual test files that import models directly).
- Jest config uses `forceExit: true` and `restoreMocks: false`.
- Tests match `**/__tests__/**/*.test.js` and `**/*.test.js` (both files under `__tests__/` and files ending in `.test.js` anywhere in `src/`).
- Frontend `npm test` runs Vitest in watch mode by default; add `--run` for non-interactive.

## Framework Quirks

### Ticket status transitions
```
backlog → in_progress → review → done
          ↑            ↑
          └────┬───────┘
         (also review/in_progress/done → backlog)
```
Valid transitions: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`, `done→backlog`.

### Agent authentication
Agents authenticate via `X-API-Key` header (format: `ak_<hex>`). Endpoints in `api/agents.js` accept either user JWT auth OR agent API key. The `agentAuthMiddleware` validates the key and enforces daily rate limits.

### Frontend auth persistence
Token and user stored in `localStorage` as `vibecode_token` and `vibecode_user`. Route guards in `router/index.ts` check `localStorage.getItem('vibecode_token')` — no Pinia dependency.

### Port mapping
- **With override** (`docker-compose.override.yml` active): frontend `3000:3000` (Vite dev server)
- **Without override**: frontend `3002:80` (nginx serving built SPA)
- Backend always `3001:3001`

### ESLint flat config
Both `backend/eslint.config.js` and `frontend/eslint.config.js` use the flat config format (no `.eslintrc`). Frontend uses `@typescript-eslint/parser` + `vue-eslint-parser` for `.vue` files.

### Database
PostgreSQL 15 on :5432, database `vibecode`. Migrations are ad-hoc SQL files executed sequentially — no migration tracking system. `apply.js` runs `001_create_tables.sql` then `002_agents_schema.sql`.

### Docker build
Backend uses multi-stage (node:18-alpine), frontend uses multi-stage (node→nginx). Frontend container serves via nginx with SPA fallback (`try_files $uri $uri/ /index.html`).

### Coding conventions (from `ai/CODING.md`)
- Use IPEE (Identify, Plan, Execute, Evaluate) for every change
- Plan 80% of effort before coding
- Add unit tests to all changes
- For breaking changes: create a branch, commit state, then change

## Completed Work

### Integration Tests with Real PostgreSQL ✅ DONE (21/21 passing)
**Solution**: Use real PostgreSQL (not Docker). PostgreSQL 18 was installed directly, Docker was uninstalled.

**What was done**:
1. Docker uninstalled, PostgreSQL 18 installed and running
2. Database `vibecode` created with user `testuser:testpass`
3. Migrations run successfully against real PostgreSQL
4. `jest.integration.config.js` updated to set `DATABASE_URL` directly (no Docker)
5. `docker.test.js` completely rewritten — pg-mem mock removed, replaced with real `pg.Pool`
6. **21/21 tests passing** with real PostgreSQL

**Bugs found and fixed during integration test runs**:
- `src/api/tickets.js` route: `priority` extracted but NOT passed to `TicketService.create()`
- `src/services/TicketService.create()`: missing `priority` parameter
- `src/models/ticket.js`: `priority` hardcoded to `'medium'` in INSERT, not using parameter
- `src/api/projects.js` route: same `priority` not-passed issue
- `src/models/user.js` constructor: wrong property names (`passwordHash` vs `password_hash`, `currentPlan` vs `current_plan`, `createdAt` vs `created_at`) — caused `bcrypt.compare()` to get `undefined`
- Test endpoint: `PATCH /api/tickets/:id/status` → corrected to `POST /api/projects/:id/tickets/:ticketId/status`
- Test transition: `in_progress → backlog` IS allowed by code, changed test to `in_progress → done`
- **Missing DELETE route** for projects: Added `router.delete('/:id', ...)` to `src/api/projects.js`
