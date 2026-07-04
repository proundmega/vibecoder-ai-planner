# Vibecode AI Planner

AI-powered Kanban SaaS. Backend: Node.js/Express (CommonJS). Frontend: Vue 3 + Vite + Pinia (ESM/TypeScript). Agent compute nodes: Java 17 + Maven.

## Quick Start

```bash
docker compose up --build                        # frontend :3000, API :3001
docker compose -f docker-compose.yml up --build  # frontend :3002

# Manual:
cd backend && npm run dev          # API :3001, uses `node --watch`
cd ../frontend && npm run dev      # Vite :3000, proxies /api → :3001
```

`.env` (root) requires: `POSTGRES_PASSWORD`, `JWT_SECRET`, `PGADMIN_PASSWORD`.

## Structure

```
backend/src/
  index.js          → exports app (NODE_ENV=test skips listen)
  api/routes.js     → /health, /version, /docs, /metrics, /auth/*, /v1/*
  api/v1/index.js   → 16 routers + inlined templates/attachments/planning routes
  services/         → 25 services
  controllers/      → 12 controllers
  models/           → approval, project, ticket, user
  migrations/       → 28 .sql files; apply.js runs 20 in non-numeric order
  middleware/       → auth, permissions, validate (Joi), cors, rate limiter, CSP, requestId, error handler, timeout, slow-req logger
  validators/       → Joi schemas
  db.js             → pg Pool (DATABASE_URL env)

frontend/src/
  stores/auth.js        → singleton Pinia store; tokens/permissions in localStorage
  api/client.js         → native `fetch` (NOT axios)
  api/generated/        → TS types via openapi-typescript-codegen
  router/index.ts       → reads vibecode_token directly from localStorage

agent/                  → Java 17 Maven, shaded JAR, eclipse-temurin Docker
```

## Testing

### Backend (Jest)
- Test files: `src/__tests__/*.test.js` + `src/middleware/*.test.js`. Default config does NOT pick up top-level `*.test.js`.
- `setupFilesAfterEnv` points to `src/__tests__/jest.setup.js` — mocks pg, winston, bcryptjs, uuid, jsonwebtoken. No real DB needed.
- `moduleDirectories: ['node_modules', '<rootDir>']` + `moduleNameMapper` for `models/`, `services/` — `require('services/Foo')` works.
- `npm test` — unit tests only (`jest --passWithNoTests`).
- `npm run test:integration` — real PG at `postgresql://postgres:changeme@localhost:5432/vibecode` (maxWorkers:1).
- Bash integration suite: `backend/integration-test/run.sh` — curl against Docker containers + real PG.

### Frontend (Vitest + Cypress)
- `npm test` runs vitest in **watch mode**; always add `--run` for CI/single-run: `npm test -- --run`.
- 17 unit test files in `src/__tests__/`. 7 Cypress e2e specs + 5 component specs in `cypress/`.
- Cypress: `npm run cypress:component` (`--browser chrome`), `npm run cypress:e2e` (`--browser chrome --headless`). Seed via `cypress/support/seed.ts`.
- `npm run typecheck` — `vue-tsc --noEmit`.
- `npm run generate:api` / `generate:spec` — regenerate TS types from OpenAPI spec (requires backend to be installable).

### CI (`.github/workflows/ci.yml`)
```
backend job:  lint → test → frontend test --run → contract tests → node --check src/index.js
frontend job: lint → typecheck → build
```

### Bug fix protocol

Every fix **must** include a regression test.

- **Route bugs**: use `supertest` against Express app in `src/__tests__/routeOrdering.test.js` or a new route test. Mock `jsonwebtoken`, `PermissionService`, DB models as needed.
- **Service/controller bugs**: extend unit tests in `src/__tests__/` using existing jest mocks.
- **Frontend bugs**: extend Vitest unit tests in `frontend/src/__tests__/`.
- Run the full suite: `npm test` (backend), `npm test -- --run` (frontend).

## API

All responses: `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }` (auth endpoints may diverge from this convention — check individual routes).

- `/api/auth/me` returns `user.id` (DB row ID), **not** JWT `userId`.
- `/api/auth/register` rate-limited (3/60s), default role `project_admin`. Login: 5/60s, lockout after 10 failures (15 min).
- `/api/docs` — Swagger UI; `/api/openapi.json` — raw spec (generated from JSDoc via swagger-jsdoc).
- Agents auth via `X-API-Key` header. Mock keys: starts with `test-` or equals `mock-agent-key`.
- `TICKET_DELETE` enforced in `TicketService.delete()` (not middleware) — `user` role can delete own tickets only.
- 26 permissions, 4 roles: `user`(9), `member`(18), `project_admin`(20), `super_admin`(26).

**Ticket status transitions**: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. `done` has no outgoing transitions.

**Migrations**: run by `src/migrations/apply.js` in this exact order: 001→002→003→004→005→006→007→008→009→010→013→014→011→012→015→016→017→018→021→029. Each has a `_rollback.sql` counterpart.

**Frontend auth**: 3 localStorage keys — `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards read localStorage directly (no Pinia dependency).

## Planning

When making architectural changes, read `planning/` templates in order: `00_ARCHITECT_CHECKLIST.md`, `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`.

**Check existing infrastructure first** — if backend API exists, work frontend-only. If frontend exists, work backend-first. Both exist → extend. Neither → plan both.

Create new planning suites in `planning/bp-XX-name/` for multi-file changes requiring architectural decisions.

## Known Bugs (regression tests required)

### `UtilityError` missing from `src/errors/HttpError.js`
`ProvisioningService.js:5` does `const { UtilityError } = require('../errors/HttpError')` but `HttpError.js` does not define or export `UtilityError`. This will throw at runtime. Fix: add `UtilityError` class to `HttpError.js` that extends `AppError`, then add a regression test.

### `ProjectList.vue:81` — edit error sets wrong ref
`handleEdit()` catch block sets `deleteError.value = 'Failed to update project'` instead of a dedicated edit-error ref. The template shows `createError || deleteError` for inline errors (line 133), so edit failures incorrectly display as delete errors. Fix: add `editError` ref and update the template to include it.

### `Ticket.update()` COALESCE prevents clearing fields to null
`src/models/ticket.js:95-101` uses `COALESCE($5, assignee_id)` pattern — passing `null` for any field leaves the existing DB value unchanged. To actually clear a field (e.g., unassign), the query must use dynamic SET clauses instead of COALESCE. Fix: build SET list dynamically, only including fields that are non-null in the update payload.

### `PermissionService.init()` has no retry logic
`src/services/PermissionService.js:61-68` calls `pool.query()` once with no retry. If the DB is temporarily unavailable at startup, permissions fail to load and all auth checks break. Fix: wrap in retry with configurable attempts/delay.

### `PoolManager.requestAgent()` has no max capacity
`src/services/PoolManager.js:30` always creates a new container when no idle agents exist. No `MAX_POOL_SIZE` check. Fix: add a configurable max and throw when reached.

### `stored_path` exposed in attachment responses
Ticket attachment listing and individual attachment endpoints return `stored_path` (server filesystem path) in responses. This leaks internal storage layout. Fix: strip `stored_path` from serialized responses.

### `/auth/me` has no rate limiting
`/api/auth/register` and `/api/auth/login` have rate limiting, but `/api/auth/me` does not. Add `rateLimiter(31, 60000)` to prevent enumeration abuse.

### `BillingDashboard.vue` uses inline computations
Totals are computed inline in the template (lines 51, 56, 59, 63, 101-104) rather than as Vue `computed` properties. This makes them untestable and repeats logic. Fix: extract to computed properties.
