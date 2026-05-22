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

- **Backend**: lint → test → `node --check src/index.js` (syntax check, runs on ubuntu:18 with postgres service)
- **Frontend**: lint → typecheck → build

## Test Quirks

- **Backend Jest** (`backend/jest.config.js`): all DB-dependent modules are fully mocked in `jest.setup.js` — `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken` are replaced with mocks that return empty rows and fixed values. Tests do NOT need a real database.
- **db.mocks.js** provides alternate mocks (used by individual test files that import models directly).
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
