# Vibecode AI Planner - Agent Guide

## Quick Start

```bash
# Docker (all services)
docker compose up --build
# With override active: frontend on 3000, without: frontend on 3002

# Manual
cd backend && npm run dev          # API on :3001
cd ../frontend && npm run dev      # Vite on :3000, proxies /api → :3001
```

## Structure

```
backend/src/
  index.js              → Express entry, exports app (for tests)
  controllers/          → billing, credential, github, memory, project, provider,
                          ticket, ticketPlanning, ticketAttachment, usage, user
  api/routes.js         → Unversioned routes: /health, /version, /docs, /metrics,
                          /auth (register/login/me), mounts /api/v1/*
  api/v1/index.js       → Versioned routes: users-management, users, projects,
                          tickets, pricing, agents, approvals, permissions,
                          github, providers, credentials, usage, billing, memory,
                          plus inline planning & attachment routes
  api/openapi-spec.js   → OpenAPI 3.0.3 spec generator from JSDoc annotations
  services/             → 16 services: Agent, Approval, Billing, Credential,
                          GitHub, Memory, Message, Permission, Project,
                          ProviderRouter, Template, TicketAttachment,
                          TicketPlanning, Ticket, UsageLogger, User
  models/               → approval, project, ticket, user (soft delete, transactions)
  middleware/           → auth, ticketOwnership, validate, errorHandler, permissions,
                          cors, requestTimeout, requestId, requestLogger,
                          slowRequest, cache, multer, apiVersion
  utils/                → cache, crypto, envValidation, logger, pagination,
                          pricing, shutdown
  validators/           → Joi schemas (auth, projects, tickets, users)
  auth.js               → AuthService (register/login/token)
  db.js                 → pg Pool
  migrations/apply.js   → runs 17 SQL migrations (see below for actual order)

agent/                  → Java 17 Maven project for compute nodes
frontend/src/
  router/index.ts       → nested routes, localStorage-based auth guard
  stores/auth.js        → Pinia store, tokens/permissions in localStorage
  api/client.js         → HTTP client (native fetch, NOT axios)
  api/validator.ts      → runtime response validation using OpenAPI schemas
  api/generated/        → TypeScript types and models from openapi-typescript-codegen
  views/                → AIAssistant, Dashboard, Login, ProjectDetail,
                          ProjectList, Register, SuperAdminUsers, TicketBoard,
                          TicketDetail, UserManagement
  components/           → TicketEditModal, UserModal
```

## Commands

| Context | Command | Notes |
|---------|---------|-------|
| Backend dev | `cd backend && npm run dev` | `node --watch src/index.js` on :3001 |
| Backend test | `cd backend && npm test` | Jest (see quirks below) |
| Backend test:integration | `cd backend && npm run test:integration` | Real PG via `DATABASE_URL` |
| Backend lint | `cd backend && npm run lint` | eslint flat config |
| Backend migrate | `cd backend && npm run db:migrate` | Runs apply.js |
| Frontend dev | `cd frontend && npm run dev` | Vite on :3000 |
| Frontend test | `cd frontend && npm test -- --run` | Vitest; **must add `--run`** for non-interactive |
| Frontend lint | `cd frontend && npm run lint` | eslint flat config |
| Frontend typecheck | `cd frontend && npm run typecheck` | `vue-tsc --noEmit` |
| Frontend build | `cd frontend && npm run build` | `vite build` → dist/ |
| OpenAPI regen | `cd frontend && npm run generate:spec && npm run generate:api` | After backend route changes |
| Full e2e | `cd backend/integration-test && ./run.sh` | Real Docker containers + real PG |

## Docker

- Services: `migrate` (runs once) → `api` (:3001) → `frontend` (:3002, or :3000 with override) → `postgres` (:5432) → `pgadmin` (:5050)
- `docker-compose.override.yml` overrides frontend port to `3000:80`
- Frontend nginx may fail on first boot if `api` upstream hostname isn't resolvable — restart the container
- Backend healthcheck: `curl -f http://localhost:3001/api/health`

## Testing Quirks

### Backend (Jest)
- **Test match** (`backend/jest.config.js`): `**/__tests__/unit.test.js`, `**/__tests__/*.test.js`, `<rootDir>/src/middleware/*.test.js`. Top-level `.test.js` files are **NOT** picked up.
- **Mocks** (`src/__tests__/jest.setup.js`): `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken` are fully mocked. Tests do NOT need a real database. Also mocks `../utils/logger`.
- **Config**: `forceExit: true`, `restoreMocks: false`, `testTimeout: 10000`
- **moduleDirectories**: `['node_modules', '<rootDir>']` — allows `require('services/...')` and `require('models/...')` without relative paths
- **Integration tests** (`npm run test:integration`): uses `jest.integration.config.js`, skips mocks, connects to real PG at `postgresql://testuser:testpass@localhost:5432/vibecode`. Migrations run automatically via `src/__tests__/integration/setup.js`.

### Frontend (Vitest + Cypress)
- Vitest runs in watch mode; **always add `--run` for CI or non-interactive use**
- Cypress scripts use `--browser chrome` (not headless by default); for headless CI, add `--headless`
- 9 test files in `frontend/src/__tests__/`: `agents.test.js`, `api-contract.test.ts`, `approvals.test.js`, `auth-store.test.js`, `auth.test.js`, `client.test.js`, `projects.test.js`, `tickets.test.js`, `users.test.js`

### CI (`.github/workflows/ci.yml`)
- **Backend**: lint → test → `node --check src/index.js` (ubuntu-latest with postgres:15 service)
- **Frontend**: lint → typecheck → build
- Runs on `main`, `develop`, and PRs

### Cypress E2E Testing
- **Spec files** (7 total in `frontend/cypress/e2e/`): `01-auth`, `02-projects`, `03-tickets`, `04-roles`, `05-registration`, `06-user-management`, `07-ticket-assignment`
- **Component tests** (5 in `frontend/cypress/component/`): `TicketBoard`, `UserModal`, `UserManagement`, `Login`, `TicketDetail`
- **Custom commands** (`cypress/support/commands.ts`): `login`, `loginAsAdmin`, `logout`, `register`, `createUser`, `createProject`, `createTicket`, `assertStatusBadge`, `assertRoleBadge`
- **Test data seeding** (`cypress/support/seed.ts`): creates 3 users (alice/project_admin, bob/member, charlie/user), 1 project, 2 tickets with timestamp-based names
- **How to run locally**: `npm run cypress:e2e` (headless Chrome) or `npm run cypress:open` (interactive)
- **How to run all**: `npm run cypress:all` (component + e2e)
- **Seed runs automatically**: `seed.ts` is called in each test's `before` hook (via `beforeEach` in individual tests or global setup)
- **Fixtures**: `users.json`, `projects.json`, `tickets.json` (static test data, supplemented by seed script)
- **Viewport**: 1280x720, video disabled, screenshots on failure, 1 retry in run mode
- **No hardcoded timeouts**: use `cy.get().should()` or `cy.intercept()` instead of `cy.wait(1000)`

## API Architecture

### Route structure
All API responses follow `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }`

- `/api/health`, `/api/version`, `/api/docs`, `/api/metrics` — unversioned system endpoints
- `/api/auth/register` — rate limited (3/60s), default role `project_admin`
- `/api/auth/login` — rate limited (5/60s), account lockout after 10 failed attempts (15 min window)
- `/api/auth/me` — returns `{ user: { id, email, name, role, plan, isActive }, authenticated: true }`. **`user.id` is the database row ID, not the JWT `userId`**
- `/api/v1/*` — all resource routes (users-management, users, projects, tickets, pricing, agents, approvals, permissions, github, providers, credentials, usage, billing, memory)
- `/api/docs` — Swagger UI; `/api/openapi.json` — raw spec

### Framework Quirks

#### Ticket status transitions
```
backlog → in_progress → review → done
          ↑            ↑
          └────┬───────┘
```
Valid: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. **`done` has no outgoing transitions.**

#### Agent authentication
Agents use `X-API-Key` header. Mock keys: `apiKey.startsWith('test-')` or `apiKey === 'mock-agent-key'`. Real agents looked up via `AgentService.getAgentByApiKey()` in DB. Agents are users with `is_agent` flag and `agent_roles` array (planner, worker, reviewer, approver).

#### Ticket lock
Single-agent ownership: tickets have `assigned_agent_id` and `locked_at`. Agents `pickUpTicket()` (backlog→in_progress), `releaseTicket()` (in_progress→backlog). Stale tickets (>60 min) auto-recovered via `recoverOrphanedTickets()`.

#### Frontend auth persistence
Token, user, and permissions stored in `localStorage` as `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards in `router/index.ts` check `localStorage.getItem('vibecode_token')` — no Pinia dependency. Auth store exposes permission helpers: `canCreateTicket()`, `canDeleteTicket()`, `canUpdateTicket()`, `canCreateUser()`, `canDeleteUser()`, `canToggleUser()`, `canAccessUsers()`, `canCreateProject()`, `canDeleteProject()`, `canCreateAgent()`, `canDeleteAgent()`, `canApprove()`, `canReject()`, etc.

#### Permission system
Granular, database-driven permissions. Two-tier enforcement:
- **Route level**: middleware (`requireAnyPermission('PERM_CODE')`)
- **Service level**: ownership checks (e.g., `TicketService.delete()` checks `TICKET_DELETE` + ownership — not middleware)

**26 permissions**: TICKET_CREATE/READ/UPDATE/DELETE/STATUS_CHANGE/COMMENT, PROJECT_CREATE/READ/UPDATE/DELETE/MANAGE_MEMBERS, USER_CREATE/READ/UPDATE/DELETE/TOGGLE_ACTIVE/VIEW_ALL, AGENT_CREATE/READ/DELETE/REVOKE, APPROVAL_APPROVE/REJECT/VIEW, PRICING_READ, DASHBOARD_READ.

**4 roles**: `user` (9 perms), `member` (18 perms), `project_admin` (20 perms), `super_admin` (all 26).

Key files: `backend/src/migrations/005_permission_system.sql`, `PermissionService.js`, `middleware/permissions.js`, `frontend/src/stores/auth.js`.

#### Database
PostgreSQL 15, database `vibecode`. Migrations are ad-hoc SQL files with `_rollback.sql` counterparts — no migration tracking. `apply.js` runs 17 files in order:

`001_create_tables` → `002_agents_schema` → `003_role_system` → `004_persistence_layer` → `005_permission_system` → `006_ticket_comments` → `007_project_repos` → `008_ticket_repo_fields` → `009_project_providers` → `010_project_credentials` → `013_usage_logs` → `014_project_billing` → `011_ticket_ownership` → `012_agent_users` → `015_shared_agent_memory` → `016_ticket_planning` → `017_agent_memory_fallback`

#### OpenAPI contract
Backend generates OpenAPI 3.0.3 spec from JSDoc annotations via `swagger-jsdoc`. Swagger UI at `/api/docs`, raw spec at `/api/openapi.json`. Frontend has `api/validator.ts` for runtime validation and `api/generated/` for TypeScript types. Contract tests (`api-contract.test.ts`) catch field mismatches (e.g., `isActive` vs `is_active`).

## Known Constraints

- **Ticket delete** — `TICKET_DELETE` check is in `TicketService.delete()`, not route middleware. Users with `user` role can delete their own tickets but not others'.
- **`user` role** — cannot create projects, manage users/agents, or approve/reject. Self-registration creates `project_admin` accounts.
- **`APPROVAL_VIEW`** — restricted to `super_admin` only (`GET /api/v1/approvals`).
- **`/api/auth/me`** — returns `user.id` (DB row ID), not `userId` (JWT payload).

## Feature Modules

### Agent Orchestration (rs-16)
Single-agent ticket lock with status-based workflow. Key: `TicketService.js`, `MessageService.js`, `middleware/ticketOwnership.js`, `ticketController.js`.

### Secure API Keys (rs-15)
Project credentials encrypted with AES-256-GCM in `project_credentials`. Keys masked in responses (last 4 chars visible). Key: `CredentialService.js`, `credentialController.js`.

### Cost Tracking (rs-17)
Per-model pricing (Anthropic 4 models, OpenAI 5 models). Usage logs track provider, model, tokens, cost, duration. Daily billing aggregation. Key: `utils/pricing.js`, `UsageLogger.js`, `BillingService.js`.

### Shared Agent Memory (rs-19)
Agents share context via `agent_memory` table with pgvector extension. HNSW index for semantic search. Key: `MemoryService.js`, `memoryController.js`.

### Java Agent Application (rs-18)
Self-contained Java 17 Maven project. Agents poll for tickets, use AI providers, create Git branches/PRs, update ticket status. Key: `agent/src/main/java/com/vibecode/agent/`, `agent/build.sh`, `agent/Dockerfile`.

## Planning Templates

When planning an improvement, read these in order:

1. **`00_ARCHITECT_CHECKLIST.md`** — Pre-implementation checklist with **Existing Infrastructure Audit** (check what already exists before creating new code)
2. **`01_ARCHITECT_REQUIREMENT.md`** — Requirement, scope, existing infrastructure audit, acceptance criteria, out of scope, testing checklist
3. **`02_ARCHITECT_DESIGN.md`** — Problem statement, current state (both backend and frontend), design with code examples (extend existing vs. create new), data flow diagram, risks/edge cases
4. **`03_ARCHITECT_IMPLEMENTATION.md`** — Actions (Phase 1: Backend, Phase 2: Frontend API, Phase 3: Frontend UI, Phase 4: Integration), rollback plan, files changed

**Always check existing infrastructure first:**
- **Backend API exists, no frontend UI?** → Frontend-only task. Add a tab/section. Create API client in `frontend/src/api/`.
- **Frontend UI exists, no backend API?** → Backend-first. Create route, controller, service, validator.
- **Both exist?** → Extending existing code. Check if feature fits in existing tabs, modals, or sections.
- **Neither exists?** → Plan both backend and frontend.
- **Partial overlap?** → Fill the gaps. Don't duplicate.

**STOP and ask the user before proceeding if:** ambiguous acceptance criteria, significant scope change, conflicting requirements, unknown unknowns, production impact, or UI placement decisions.

After implementation, update `03_ARCHITECT_IMPLEMENTATION.md` with date, PR URL, and branch. Complete the checklist in `00_ARCHITECT_CHECKLIST.md`.

Create new planning suites in `planning/bp-XX-name/` when the change affects multiple files, requires architectural decisions, has risks/edge cases, or needs both backend API and frontend UI.

## Coding Conventions

From `ai/CODING.md`:
- Use IPEE (Identify, Plan, Execute, Evaluate) for every change
- Plan 80% of effort before coding
- Add unit tests to all changes
- For breaking changes: create a branch, commit state, then change
