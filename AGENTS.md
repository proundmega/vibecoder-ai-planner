# Vibecode AI Planner - Agent Guide

## Quick Start

```bash
# Docker (all services)
docker compose up --build
# With override active: frontend on 3000, without: frontend on 3002

# Manual
cd backend && npm run dev          # API on :3001
cd ../frontend && npm run dev      # Vite on :3000, proxies /api -> :3001
```

## Structure

```
backend/src/
  index.js              → Express entry, exports app (for tests)
  api/routes.js         → Unversioned routes: /health, /version, /docs, /metrics,
                          /auth (register/login/me), mounts /api/v1/*
  api/v1/index.js       → Versioned routes: users, projects, tickets, pricing,
                          agents, approvals, permissions, github, providers,
                          credentials, usage, billing, memory
  api/openapi-spec.js   → OpenAPI 3.0.3 spec generator from JSDoc annotations
  services/             → 16 services (Agent, Approval, Billing, Credential,
                          GitHub, Memory, Message, Permission, Project,
                          ProviderRouter, Template, TicketAttachment,
                          TicketPlanning, Ticket, UsageLogger, User)
  models/               → approval, project, ticket, user (soft delete, transactions)
  middleware/           → auth, ticketOwnership, validate, permissions, cors, etc.
  validators/           → Joi schemas (auth, projects, tickets, users)
  auth.js               → AuthService (register/login/token)
  db.js                 → pg Pool
  migrations/apply.js   → runs 17 SQL migrations

agent/                  → Java 17 Maven project for compute nodes
frontend/src/
  stores/auth.js        → Pinia store, tokens/permissions in localStorage
  api/client.js         → HTTP client (native fetch, NOT axios)
  api/validator.ts      → runtime response validation using OpenAPI schemas
  api/generated/        → TypeScript types from openapi-typescript-codegen
  router/index.ts       → nested routes, localStorage-based auth guard
```

## Docker

- Services: `migrate` (runs once) → `api` (:3001) → `frontend` (:3002, or :3000 with override) → `postgres` (:5432) → `pgadmin` (:5050)
- `docker-compose.override.yml` overrides frontend port to `3000:80`
- Frontend nginx may fail on first boot if `api` upstream hostname isn't resolvable — restart the container

## Testing

### Backend (Jest)
- Test files in `backend/src/__tests__/*.test.js` only. Top-level `.test.js` files are **NOT** picked up.
- `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken` are fully mocked via `jest.setup.js`. No real DB needed.
- `moduleDirectories: ['node_modules', '<rootDir>']` — `require('services/...')` works without relative paths.
- Integration tests (`npm run test:integration`): skips mocks, connects to real PG at `postgresql://testuser:testpass@localhost:5432/vibecode`.
- Bash integration suite (`backend/integration-test/run.sh`): curl-based tests against real Docker containers + real PG. Covers auth, projects, tickets, status transitions, agents, frontend proxy, route ordering, role-based permissions, approvals, JWT expiry, credentials, ticket ownership, usage tracking, billing, and agent memory. Requires `docker compose up` first.

### Frontend (Vitest + Cypress)
- Vitest runs in watch mode; **always add `--run` for non-interactive use**: `npm test -- --run`
- 9 unit test files in `frontend/src/__tests__/`
- 7 Cypress e2e specs + 5 component tests in `frontend/cypress/`
- Cypress uses `--browser chrome` (not headless by default); e2e script adds `--headless`
- Test data seeded automatically via `cypress/support/seed.ts` (3 users, 1 project, 2 tickets)

## API Architecture

All responses: `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }`

### Key quirks
- `/api/auth/me` returns `user.id` (DB row ID), **not** JWT `userId`
- `/api/auth/register` — rate limited (3/60s), default role `project_admin`
- `/api/auth/login` — rate limited (5/60s), lockout after 10 failed attempts (15 min)
- `/api/docs` — Swagger UI; `/api/openapi.json` — raw spec

### Ticket status transitions
```
backlog → in_progress → review → done
          ↑            ↑
          └────┬───────┘
```
Valid: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. **`done` has no outgoing transitions.**

### Agent auth
Agents use `X-API-Key` header. Mock keys: `apiKey.startsWith('test-')` or `apiKey === 'mock-agent-key'`.

### Ticket lock
Single-agent ownership via `assigned_agent_id` and `locked_at`. Stale tickets (>60 min) auto-recovered.

### Frontend auth
Tokens stored in `localStorage` as `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards check `localStorage` directly — no Pinia dependency.

### Permission system
Two-tier enforcement: route-level middleware + service-level ownership checks.
- **26 permissions**: TICKET_CREATE/READ/UPDATE/DELETE/STATUS_CHANGE/COMMENT, PROJECT_CREATE/READ/UPDATE/DELETE/MANAGE_MEMBERS, USER_CREATE/READ/UPDATE/DELETE/TOGGLE_ACTIVE/VIEW_ALL, AGENT_CREATE/READ/DELETE/REVOKE, APPROVAL_APPROVE/REJECT/VIEW, PRICING_READ, DASHBOARD_READ
- **4 roles**: `user` (9), `member` (18), `project_admin` (20), `super_admin` (26)
- `TICKET_DELETE` check is in `TicketService.delete()`, not middleware — `user` role can delete own tickets only
- `APPROVAL_VIEW` — `super_admin` only

### Database
PostgreSQL 15 with pgvector extension. 17 migrations in `backend/src/migrations/` (with `_rollback.sql` counterparts), applied via `apply.js` in numeric order: `001` → `002` → `003` → `004` → `005` → `006` → `007` → `008` → `009` → `010` → `013` → `014` → `011` → `012` → `015` → `016` → `017`.

### OpenAPI contract
Backend generates spec from JSDoc via `swagger-jsdoc`. Frontend validates at runtime (`api/validator.ts`) and generates TS types (`api/generated/`).

## Planning Templates

When planning improvements, read `ARCHITECT/` templates in order:
1. `00_ARCHITECT_CHECKLIST.md` — Pre-implementation checklist with **Existing Infrastructure Audit**
2. `01_ARCHITECT_REQUIREMENT.md` — Scope, acceptance criteria, testing checklist
3. `02_ARCHITECT_DESIGN.md` — Problem, current state, design with code examples, data flow
4. `03_ARCHITECT_IMPLEMENTATION.md` — Phased actions, rollback plan

**Always check existing infrastructure first** — don't duplicate. Backend API exists → frontend-only. Frontend exists → backend-first. Both exist → extend. Neither → plan both.

**STOP and ask** before: ambiguous criteria, significant scope change, conflicting requirements, production impact, or UI placement decisions.

Create new planning suites in `planning/bp-XX-name/` for multi-file changes requiring architectural decisions.
