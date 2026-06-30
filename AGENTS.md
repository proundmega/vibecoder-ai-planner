# Vibecode AI Planner

AI-powered Kanban SaaS with integrated AI agents. Backend: Node.js/Express (CommonJS). Frontend: Vue 3 + Vite + Pinia (ESM/TypeScript). Agent compute nodes: Java 17 + Maven.

## Quick Start

```bash
docker compose up --build                        # all services, frontend on :3002
docker compose -f docker-compose.yml up --build   # without override, also :3002

# Manual (two terminals)
cd backend && npm run dev          # API on :3001, uses Node --watch
cd ../frontend && npm run dev      # Vite on :3000, proxies /api -> :3001
```

`.env` (root) requires: `POSTGRES_PASSWORD`, `JWT_SECRET`.

## Structure

```
backend/src/
  index.js          → exports app (required by tests; NODE_ENV=test skips listen)
  api/routes.js     → unversioned: /health, /version, /docs, /metrics, /auth/*
                        mounts /api/v1/*
  api/v1/index.js   → 18 route modules (users, projects, tickets, pricing, agents,
                        approvals, permissions, github, providers, credentials,
                        usage, billing, memory, planning, templates, attachments)
  services/         → 16 services (Agent, Approval, Billing, Credential, GitHub,
                        Memory, Message, Permission, Project, ProviderRouter,
                        Template, TicketAttachment, TicketPlanning, Ticket,
                        UsageLogger, User)
  controllers/      → 12 controllers
  models/           → approval, project, ticket, user
  migrations/       → 17 .sql files, ran in non-numeric order by apply.js
  middleware/       → auth, permissions, validate (Joi), cors, ticketOwnership, etc.
  validators/       → Joi schemas
  auth.js           → AuthService (register/login/token)
  db.js             → pg Pool (DATABASE_URL or DATABASE_URL_LOCAL env)

frontend/src/
  stores/auth.js        → singleton Pinia store; tokens/permissions in localStorage
  api/client.js         → native fetch (NOT axios; axios in deps is unused)
  api/validator.ts      → runtime response validation from OpenAPI
  api/generated/        → TS types via openapi-typescript-codegen
  router/index.ts       → localStorage-based auth guard (reads vibecode_token directly)

agent/                  → Java 17 Maven project for compute nodes
```

## Testing

### Backend (Jest)
- Test files: `src/__tests__/*.test.js` + `src/middleware/*.test.js`. Top-level `.test.js` is **NOT** picked up.
- `jest.setup.js` mocks `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken`. No real DB needed.
- `moduleDirectories: ['node_modules', '<rootDir>']` + `moduleNameMapper` for `models/`, `services/` — `require('services/Foo')` without relative paths.
- `npm test` — unit tests only; `npm run test:integration` — real PG at `postgresql://postgres:changeme@localhost:5432/vibecode` (maxWorkers:1).
- Bash integration suite: `backend/integration-test/run.sh` — curl against Docker containers + real PG.

### Frontend (Vitest + Cypress)
- `npm test` runs vitest in **watch mode**; always add `--run` for CI/single-run: `npm test -- --run`.
- 17 unit test files in `src/__tests__/`. 7 Cypress e2e specs + 5 component tests in `cypress/`.
- Cypress: component uses `--browser chrome`, e2e adds `--headless`. Test data seeded via `cypress/support/seed.ts`.
- `npm run typecheck` — `vue-tsc --noEmit`. `npm run generate:api` / `generate:spec` — regenerate TS types from OpenAPI spec.

### CI pipeline (`.github/workflows/ci.yml`)
```
backend lint → backend test → frontend test --run → frontend contract tests → backend syntax check
frontend lint → frontend typecheck → frontend build
```

### Bug fix protocol

Every bug fix **must** include a regression test that reproduces the failure condition.

- **Route bugs** (wrong handler, missing route, ordering issues): use `supertest` against the Express app in `src/__tests__/routeOrdering.test.js` or a dedicated route test file. Mock `jsonwebtoken`, `PermissionService`, and DB models as needed.
- **Service/controller bugs**: add or extend unit tests in `src/__tests__/` using the existing jest mocks.
- **Frontend bugs**: add or extend Vitest unit tests in `frontend/src/__tests__/`.
- Run the full test suite after changes: `npm test` (backend), `npm test -- --run` (frontend).

## API

All responses: `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }`.

- `/api/auth/me` returns `user.id` (DB row ID), **not** JWT `userId`.
- `/api/auth/register` rate-limited (3/60s), default role `project_admin`. Login: 5/60s, lockout after 10 failures (15 min).
- `/api/docs` — Swagger UI; `/api/openapi.json` — raw spec. Generated from JSDoc via swagger-jsdoc.
- Agents auth via `X-API-Key` header. Mock keys: starts with `test-` or equals `mock-agent-key`.
- `TICKET_DELETE` enforced in `TicketService.delete()` (not middleware) — `user` role can delete own tickets only.
- `APPROVAL_VIEW` — `super_admin` only.
- 26 permissions, 4 roles: `user`(9), `member`(18), `project_admin`(20), `super_admin`(26).

**Ticket status transitions**: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. `done` has no outgoing transitions.

**Migrations**: run by `src/migrations/apply.js` in this exact order (non-numeric): 001→002→003→004→005→006→007→008→009→010→013→014→011→012→015→016→017. Each has a `_rollback.sql` counterpart.

**Frontend auth**: 3 localStorage keys — `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards read localStorage directly (no Pinia dependency).

## Planning improvements

When planning changes, read `planning/` templates in order: `00_ARCHITECT_CHECKLIST.md`, `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`.

**Check existing infrastructure first** — don't duplicate. Backend API exists → frontend-only. Frontend exists → backend-first. Both exist → extend. Neither → plan both.

Create new planning suites in `planning/bp-XX-name/` for multi-file changes requiring architectural decisions.
