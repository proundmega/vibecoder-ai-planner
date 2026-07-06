# Vibecode AI Planner

AI-powered Kanban SaaS. Backend: Node.js/Express (CommonJS). Frontend: Vue 3 + Vite + Pinia (ESM/TypeScript). Agent compute nodes: Java 17 + Maven.

## How to investigate

Read highest-value sources first: `README*`, root manifests, workspace config, lockfiles, build/test/lint/typecheck/codegen config, CI workflows, existing instruction files (`ai/CODING.md`, `ai/IPEE.md`). Prefer executable sources (package.json scripts, jest/vitest configs, CI) over prose. If docs conflict with config, trust the config.

## Quick Start

```bash
docker compose up --build                        # dev: frontend :3000, API :3001, PG :5432
docker compose -f docker-compose.yml up --build  # prod-style: frontend :3002, API :3001

# Manual dev:
cd backend && npm run dev          # API :3001, uses `node --watch`
cd ../frontend && npm run dev      # Vite :3000, proxies /api → :3001
```

`.env` (root) requires: `POSTGRES_PASSWORD`, `JWT_SECRET`, `PGADMIN_PASSWORD`, `ENCRYPTION_KEY`.

## Structure

```
backend/src/
  index.js          → exports app (NODE_ENV=test skips listen; supertest uses app directly)
  api/routes.js     → /health, /version, /docs, /metrics, /auth/*, /v1/*
  api/v1/index.js   → 16 routers + inlined templates/attachments/planning routes
  services/         → ~25 services
  controllers/      → ~12 controllers
  models/           → approval, project, ticket, user
  migrations/       → 37 .sql files + 2 data migrations; apply.js runs in array order (not numeric)
  middleware/       → auth, permissions, validate (Joi), cors, rate limiter, CSP, requestId, error handler, timeout
  validators/       → Joi schemas
  db.js             → pg Pool (DATABASE_URL env)

frontend/src/
  stores/auth.js        → singleton Pinia store; tokens/permissions in localStorage
  api/client.js         → native `fetch` (NOT axios, despite axios being a dep)
  api/generated/        → TS types via openapi-typescript-codegen
  router/index.ts       → reads vibecode_token directly from localStorage

agent/                  → Java 17 Maven, shaded JAR, eclipse-temurin Docker
ai/CODING.md            → IPEE methodology (mandatory for all code changes)
architecture/           → system-design.md
planning/               → 00-04 templates + bp-XX/, bt-XX/, fg-XX/ suites
```

## Commands

### Backend (from `backend/`)
```bash
npm run dev          # node --watch src/index.js → :3001
npm test             # Jest unit tests (jest --passWithNoTests)
npm run test:coverage # Jest with coverage
npm run test:integration # Real PG at postgresql://postgres:changeme@localhost:5432/vibecode
npm run lint         # ESLint flat config (eslint.config.js)
npm run db:migrate   # node src/migrations/apply.js
npm run db:reset     # same as migrate
npm run generate:spec # Generate openapi-generated.json from JSDoc
```

### Frontend (from `frontend/`)
```bash
npm run dev          # Vite :3000, proxies /api → :3001
npm run build        # vite build
npm run lint         # ESLint flat config (eslint.config.js)
npm test             # Vitest in **watch mode**; use `npm test -- --run` for CI
npm run typecheck    # vue-tsc --noEmit (strict + noUnusedLocals + noUnusedParameters)
npm run generate:api # openapi-typescript-codegen from backend openapi-generated.json
npm run cypress:e2e  # cypress run --e2e --browser chrome --headless
npm run cypress:component # cypress run --component --browser chrome
```

### Docker
```bash
docker compose up --build          # dev mode (override: frontend :3000, API :3001, PG :5432)
docker compose -f docker-compose.yml up --build  # production ports (frontend :3002)
docker compose --profile dev up    # includes pgadmin on :5050
```

## Testing

### Backend (Jest)
- Test files: `src/__tests__/*.test.js` + `src/middleware/*.test.js`. Default config does NOT pick up top-level `*.test.js`.
- `setupFilesAfterEnv`: `src/__tests__/jest.setup.js` — mocks pg, winston, bcryptjs, uuid, jsonwebtoken. No real DB needed.
- `moduleDirectories: ['node_modules', '<rootDir>']` + `moduleNameMapper` for `models/`, `services/` — `require('services/Foo')` works.
- Integration tests: `jest.integration.config.js` — real PG, `maxWorkers:1`, `testTimeout:30000`, no mock restore (`restoreMocks: false`).
- Bash integration suite: `backend/integration-test/run.sh` — curl against Docker containers + real PG.

### Frontend (Vitest + Cypress)
- 22 unit test files in `src/__tests__/`. 7 Cypress e2e specs + 5 component specs in `cypress/`.
- Contract test: `frontend/src/__tests__/api-contract.test.ts` — verified in CI.
- Cypress seed: `cypress/support/seed.ts`.

### CI (`.github/workflows/ci.yml`)
```
backend job:  setup node → npm ci → lint → test → contract test (frontend/api-contract.test.ts) → node --check src/index.js
frontend job: setup node → npm ci → lint → typecheck → build
```
Backend CI job runs a real PostgreSQL service container.

### Bug fix protocol
Every fix **must** include a regression test.
- **Route bugs**: `supertest` against Express app in `src/__tests__/routeOrdering.test.js` or a new route test.
- **Service/controller bugs**: extend unit tests in `src/__tests__/` using existing jest mocks.
- **Frontend bugs**: extend Vitest unit tests in `frontend/src/__tests__/`.
- After fixing, run tests in order: the layer you changed, then the other layer, then integration tests.
- For backend changes: `npm test` → `npm test -- --run` (frontend) → `npm run test:integration` → `bash backend/integration-test/run.sh`.
- For frontend changes: `npm test -- --run` → `npm test` (backend) → `npm run test:integration` → `bash backend/integration-test/run.sh`.

## API

All responses: `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }` (auth endpoints may diverge).

- `/api/auth/me` returns `user.id` (DB row ID), **not** JWT `userId`.
- `/api/auth/register` rate-limited (3/60s), default role `project_admin`. Login: 5/60s, lockout after 10 failures (15 min). `/auth/me`: 30/60s.
- `/api/docs` — Swagger UI; `/api/openapi.json` — raw spec (generated from JSDoc via swagger-jsdoc).
- Agents auth via `X-API-Key` header. Mock keys: starts with `test-` or equals `mock-agent-key`.
- `TICKET_DELETE` enforced in `TicketService.delete()` (not middleware) — `user` role can delete own tickets only.
- 26 permissions, 4 roles: `user`(9), `member`(18), `project_admin`(20), `super_admin`(26).

**Ticket status transitions**: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. `done` has no outgoing transitions.

**Migrations**: run by `src/migrations/apply.js` in array order (37 SQL files + 2 data migrations). Notable non-numeric entries: 011/012 after 014; 020 after 018 (no 019); 029 and 031 each have two files. Each SQL has a `_rollback.sql` counterpart.

**Frontend auth**: 3 localStorage keys — `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards read localStorage directly (no Pinia dependency).

## Planning

When making architectural changes, read `planning/` templates in order: `00_ARCHITECT_CHECKLIST.md`, `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md` (if exists).

**Check existing infrastructure first** — if backend API exists, work frontend-only. If frontend exists, work backend-first. Both exist → extend. Neither → plan both.

Create new planning suites in `planning/bp-XX-name/` for multi-file changes requiring architectural decisions.

**Pending tickets**: See `PENDING.txt` for all unimplemented planning suites. Completed suites are in `planning/DONE/`.

## Coding methodology

All code changes **must** follow the IPEE methodology defined in `ai/CODING.md` and `ai/IPEE.md`:

1. **Identify** — define the problem, inputs, outputs, constraints, edge cases
2. **Plan** — brainstorm solutions, evaluate, select strategy (spend ~80% planning vs coding)
3. **Execute** — implement, follow best practices
4. **Evaluate** — test against expected outcomes, edge cases, performance

State which IPEE step you're in at each moment. Skipping any step is not permitted.

## Gotchas

- Backend ESLint uses **flat config** (`eslint.config.js`), not `.eslintrc*`.
- Frontend ESLint uses flat config with TypeScript + Vue plugins; Vue components require `PascalCase` names, `camelCase` props, and `require-default-prop`.
- Frontend `api/client.js` uses native `fetch` — **not axios** (axios is a transitive dep but unused for API calls).
- Docker compose has two modes: `docker compose up` uses `docker-compose.override.yml` (dev ports 3000/3001); `docker compose -f docker-compose.yml up` uses production ports (frontend 3002).
- Backend `npm run dev` uses `node --watch` (Node 18+ experimental flag).
- Frontend `npm test` runs Vitest in watch mode; CI uses `npm test -- --run`.
- Jest mocks pg, winston, bcryptjs, uuid, jsonwebtoken — no real DB for unit tests.
- Integration tests (`npm run test:integration`) use a real PG at `postgresql://postgres:changeme@localhost:5432/vibecode` with `maxWorkers:1`.
- Migration order in `apply.js` is array order, not numeric — 011/012 appear after 014.
- TypeScript strict mode: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCases in Switch` are all errors.
