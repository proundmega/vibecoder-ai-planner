# Vibecode AI Planner - Agent Guide

## Quick Start

```bash
# Required env vars (see .env)
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
| Backend test:integration | `npm run test:integration` | Real PostgreSQL via `DATABASE_URL` |
| Backend lint | `npm run lint` | `eslint src/` (flat config) |
| Backend migrate | `npm run db:migrate` | Run SQL migrations via apply.js |
| Frontend dev | `npm run dev` | Vite on :3000 |
| Frontend test | `npm test` | Vitest (watch mode; add `--run` for CI) |
| Frontend lint | `npm run lint` | `eslint src/` (flat config) |
| Frontend typecheck | `npm run typecheck` | `vue-tsc --noEmit` |
| Frontend build | `npm run build` | `vite build` → dist/ |

## Full Integration Tests

`backend/integration-test/run.sh` — end-to-end test suite against real Docker containers + real PostgreSQL.

```bash
# Build, start, run all tests (health, auth, CRUD, status transitions, agents, frontend)
cd backend/integration-test && ./run.sh

# Run tests only (skip docker compose up, assumes services already running)
./run.sh --only
```

Covers: health check, user registration/login, project CRUD, ticket CRUD, all status transitions (valid + invalid), agent creation, frontend SPA serving, auth enforcement.

## CI (`.github/workflows/ci.yml`)

- **Backend**: lint → test → `node --check src/index.js` (runs on ubuntu-latest with postgres:15 service)
- **Frontend**: lint → typecheck → build
- Both run on `main` and `develop` branches + PRs

## Test Quirks

- **Jest test match** (`backend/jest.config.js`): `**/__tests__/unit.test.js`, `**/__tests__/*.test.js`, `<rootDir>/src/middleware/*.test.js`. Not `**/*.test.js` — top-level `.test.js` files are NOT picked up.
- **Jest mocks** (`src/__tests__/jest.setup.js`): `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken` are fully mocked. Tests do NOT need a real database.
- **Jest config**: `forceExit: true`, `restoreMocks: false`, `testTimeout: 10000`.
- **`src/__tests__/db.mocks.js`**: alternate mocks for files that import models directly.
- **Integration tests** (`npm run test:integration`): uses `jest.integration.config.js`, skips mocks, connects to real PostgreSQL via `DATABASE_URL` (hardcoded to `postgresql://testuser:testpass@localhost:5432/vibecode`). Migrations run automatically via `src/__tests__/integration/setup.js`. Tests in `src/__tests__/integration/docker.test.js`.
- **Frontend**: no e2e test script exists (README mentions one but it's not in package.json).

## Framework Quirks

### Ticket status transitions
```
backlog → in_progress → review → done
          ↑            ↑
          └────┬───────┘
         (also review/in_progress → backlog)
```
Valid transitions: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. **`done` has no outgoing transitions** — cannot go back from done.

### Agent authentication
Agents authenticate via `X-API-Key` header. The middleware in `middleware/auth.js` checks `apiKey.startsWith('test-')` or `apiKey === 'mock-agent-key'`. Agent endpoints in `api/agents.js` accept user JWT OR agent API key.

### Frontend auth persistence
Token and user stored in `localStorage` as `vibecode_token` and `vibecode_user`. Route guards in `router/index.ts` check `localStorage.getItem('vibecode_token')` — no Pinia dependency.

### Port mapping
- **With override** (`docker-compose.override.yml` active): frontend `3000:80` (nginx serving built SPA)
- **Without override**: frontend `3002:80` (nginx serving built SPA)
- Backend always `3001:3001`
- PGAdmin always `5050:80`

### ESLint flat config
Both `backend/eslint.config.js` and `frontend/eslint.config.js` use flat config. Frontend uses `@typescript-eslint/parser` + `vue-eslint-parser` + `eslint-plugin-vue` for `.vue` files. Frontend lint catches unused vars, unused components, missing emit declarations, and more.

### Frontend Known Issues (not caught by lint)
The following issues exist in the frontend code and are NOT caught by the current lint rules. Fix them when working on the affected files:

- **`authStore.user` is a `ref`** — in script code, must access via `authStore.user.value`. Direct access (`authStore.user.role`) always returns `undefined`. Affects: `TicketBoard.vue` (canCreate, canUpdateTicket), `TicketDetail.vue` (addCommentText, canUpdate), `AIAssistant.vue` (addCommentText).
- **`route.params.projectId` is always undefined** — router param is `id` (from `projects/:id/ai`), not `projectId`. Affects: `AIAssistant.vue` (loadAgentInfo, handleSubmit).
- **Project selection in TicketBoard has no `@change` handler** — `v-model="selectedProjectId"` does not reload tickets.
- **Drag-drop in TicketBoard modifies throwaway object** — `handleDrop` receives `{id}` and modifies it instead of the real ticket in `tickets.value`.
- **`+ New Ticket` button in TicketBoard is dead code** — sets `error = '...'` instead of creating a ticket.
- **Comments in TicketDetail are never persisted** — `addCommentText()` only pushes to local `comments` ref.
- **`ProjectDetail.vue` is an empty placeholder** — just `<h1>Project Detail</h1>`.

### Database
PostgreSQL 15 in Docker, database `vibecode`. Migrations are ad-hoc SQL files executed sequentially — no migration tracking. `apply.js` runs `001_create_tables.sql` then `002_agents_schema.sql`.

### Docker build
Backend: multi-stage (node:18-alpine). Frontend: multi-stage (node→nginx). Frontend container serves via nginx with SPA fallback (`try_files $uri $uri/ /index.html`).

### Docker compose startup order
The `migrate` service runs first (applies SQL migrations), then `api` starts (depends on migration completion), then `frontend`.

### Known Bugs / Gotchas
- **`static async fromRow()`** in `models/project.js` and `models/ticket.js` — must NOT be `async` (no `await` inside). An async `fromRow` returns a Promise, causing `findAll` to return `[{ }]` arrays.
- **`docker-compose.override.yml`** frontend ports must be `3000:80` (host:container nginx port), not `3000:3000`.
- **Frontend nginx** may fail to start if the `api` upstream hostname isn't resolvable at startup. Restart the frontend container if it fails on first boot.
- **`UserService.authenticate()`** duplicates JWT signing logic that already exists in `auth.js` — both use `JWT_SECRET` but `UserService` also re-declares it locally.
- **`/api/auth/me`** returns `userId` (from JWT payload) instead of `id` in the user object.

### Coding conventions (from `ai/CODING.md`)
- Use IPEE (Identify, Plan, Execute, Evaluate) for every change
- Plan 80% of effort before coding
- Add unit tests to all changes
- For breaking changes: create a branch, commit state, then change
