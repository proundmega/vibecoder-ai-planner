# Vibecode AI Planner - Agent Guide

## Quick Start

```bash
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
  controllers/          → ticket, project, user, agent, credential, usage, billing, memory, provider, github
  api/routes.js         → All route mounting (/health, /auth, /projects, /tickets, /agents, /credentials, /usage, /billing, /memory, /providers, /github, /approvals, /permissions)
  api/{projects,tickets,agents,pricing,user,approvals,permissions,github,providers,credentials,usage,billing,memory}.js  → route modules
  api/openapi-spec.js   → OpenAPI 3.0.3 spec generator from JSDoc annotations
  services/{Project,Ticket,User,Agent,Permission,Credential,UsageLogger,BillingService,MessageService,MemoryService,Approval,ProviderRouter,GitHub}.js  → business logic
  models/{user,project,ticket}.js  → DB models (soft delete, transaction support)
  utils/pricing.js      → per-model pricing (Anthropic + OpenAI)
  middleware/auth.js    → verifyToken, agentAuth, rateLimiter, requireActiveUser
  middleware/ticketOwnership.js → requireTicketOwnership, getTicket
  middleware/validate.js → Joi validation middleware
  middleware/errorHandler.js → Error handling middleware
  middleware/permissions.js → requireAnyPermission(...codes), requireAllPermissions(...codes)
  validators/           → Joi schemas (auth, projects, tickets, users)
  auth.js               → AuthService (register/login/token)
  db.js                 → pg Pool
  migrations/apply.js   → runs 17 SQL migrations (see below for actual order)
agent/                  → Java 17 Maven project for compute nodes
frontend/src/
  router/index.ts       → nested routes, localStorage-based auth guard
  stores/auth.js        → Pinia store, tokens/permissions in localStorage
  api/client.js         → HTTP client (axios wrapper)
  api/validator.ts      → runtime response validation using OpenAPI schemas
  api/generated/        → TypeScript types and models auto-generated from OpenAPI spec
  views/{Login,Register,ProjectList,ProjectDetail,TicketBoard,TicketDetail,AIAssistant,Dashboard,UserManagement,SuperAdminUsers}.vue
  components/{TicketEditModal,UserModal}.vue
```

## Commands

| Context | Command | What it does |
|---------|---------|-------------|
| Backend dev | `npm run dev` | `node --watch src/index.js` on :3001 |
| Backend test | `npm test` | Jest (see Test Quirks) |
| Backend test:integration | `npm run test:integration` | Real PostgreSQL via `DATABASE_URL` |
| Backend lint | `npm run lint` | `eslint src/` (flat config) |
| Backend migrate | `npm run db:migrate` | Run SQL migrations via apply.js |
| Frontend dev | `npm run dev` | Vite on :3000 |
| Frontend test | `npm test` | Vitest (watch mode; add `--run` for CI) |
| Frontend generate:spec | `npm run generate:spec` | Generate OpenAPI spec from backend |
| Frontend generate:api | `npm run generate:api` | Generate TypeScript types from OpenAPI spec |
| Frontend cypress:component | `npm run cypress:component` | Cypress component tests (headless) |
| Frontend cypress:e2e | `npm run cypress:e2e` | Cypress E2E tests (headless, needs backend) |
| Frontend cypress:all | `npm run cypress:all` | All Cypress tests |
| Frontend lint | `npm run lint` | `eslint src/` (flat config) |
| Frontend typecheck | `npm run typecheck` | `vue-tsc --noEmit` |
| Frontend build | `npm run build` | `vite build` → dist/ |

## Full Integration Tests

`backend/integration-test/run.sh` — end-to-end against real Docker containers + real PostgreSQL.

```bash
cd backend/integration-test && ./run.sh          # Build, start, run all tests
./run.sh --only                                   # Run tests only (assumes services running)
```

## Docker

- **With override** (`docker-compose.override.yml` active): frontend `3000:80`
- **Without override**: frontend `3002:80` (nginx serving built SPA)
- Backend always `3001:3001`, PGAdmin always `5050:80`
- Startup order: `migrate` → `api` → `frontend`
- Frontend nginx may fail on first boot if `api` upstream hostname isn't resolvable — restart the container.

## Test Quirks

- **Jest test match** (`backend/jest.config.js`): `**/__tests__/unit.test.js`, `**/__tests__/*.test.js`, `<rootDir>/src/middleware/*.test.js`. Top-level `.test.js` files are **NOT** picked up.
- **Jest mocks** (`src/__tests__/jest.setup.js`): `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken`, `PermissionService` are fully mocked. Tests do NOT need a real database.
- **Jest config**: `forceExit: true`, `restoreMocks: false`, `testTimeout: 10000`.
- **`src/__tests__/db.mocks.js`**: alternate mocks for files that import models directly.
- **Integration tests** (`npm run test:integration`): uses `jest.integration.config.js`, skips mocks, connects to real PostgreSQL via `DATABASE_URL` (`postgresql://testuser:testpass@localhost:5432/vibecode`). Migrations run automatically via `src/__tests__/integration/setup.js`.
- **Frontend test**: `vitest` runs in watch mode; add `--run` for CI.

## CI (`.github/workflows/ci.yml`)

- **Backend**: lint → test → `node --check src/index.js` (runs on ubuntu-latest with postgres:15 service)
- **Frontend**: lint → typecheck → build
- Both run on `main`, `develop`, and PRs.

## Framework Quirks

### Ticket status transitions
```
backlog → in_progress → review → done
          ↑            ↑
          └────┬───────┘
```
Valid transitions: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. **`done` has no outgoing transitions**.

### Agent authentication
Agents authenticate via `X-API-Key` header. Middleware checks `apiKey.startsWith('test-')` or `apiKey === 'mock-agent-key'`. Agents are users with `is_agent` flag and `agent_roles` array (planner, worker, reviewer, approver).

### Frontend auth persistence
Token, user, and permissions stored in `localStorage` as `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards in `router/index.ts` check `localStorage.getItem('vibecode_token')` — no Pinia dependency. Auth store exposes permission helpers: `canCreateTicket()`, `canDeleteTicket()`, `canUpdateTicket()`, `canCreateUser()`, `canDeleteUser()`, `canToggleUser()`, `canAccessUsers()`, etc.

### Permission System
Granular, database-driven permissions. Roles map to permissions in DB, code checks `hasPermission('PERM_CODE')`.

**26 Permissions**: TICKET_CREATE/READ/UPDATE/DELETE/STATUS_CHANGE/COMMENT, PROJECT_CREATE/READ/UPDATE/DELETE/MANAGE_MEMBERS, USER_CREATE/READ/UPDATE/DELETE/TOGGLE_ACTIVE/VIEW_ALL, AGENT_CREATE/READ/DELETE/REVOKE, APPROVAL_APPROVE/REJECT/VIEW, PRICING_READ, DASHBOARD_READ.

**4 Roles**: `user` (9 perms), `member` (18 perms), `project_admin` (20 perms), `super_admin` (all 26).

Key files: `backend/src/migrations/005_permission_system.sql`, `backend/src/services/PermissionService.js`, `backend/src/middleware/permissions.js`, `frontend/src/stores/auth.js`.

Route-level checks use permission middleware. Service-level checks handle ownership. Frontend fetches permissions on login/register.

### Database
PostgreSQL 15, database `vibecode`. Migrations are ad-hoc SQL files — no migration tracking. `apply.js` runs 17 files in this order:
`001_create_tables.sql` → `002_agents_schema.sql` → `003_role_system.sql` → `004_persistence_layer.sql` → `005_permission_system.sql` → `006_ticket_comments.sql` → `007_project_repos.sql` → `008_ticket_repo_fields.sql` → `009_project_providers.sql` → `010_project_credentials.sql` → `013_usage_logs.sql` → `014_project_billing.sql` → `011_ticket_ownership.sql` → `012_agent_users.sql` → `015_shared_agent_memory.sql`

### ESLint flat config
Both `backend/eslint.config.js` and `frontend/eslint.config.js` use flat config. Frontend uses `@typescript-eslint/parser` + `vue-eslint-parser` + `eslint-plugin-vue` for `.vue` files.

### Coding conventions (from `ai/CODING.md`)
- Use IPEE (Identify, Plan, Execute, Evaluate) for every change
- Plan 80% of effort before coding
- Add unit tests to all changes
- For breaking changes: create a branch, commit state, then change

## Known Constraints

- **Ticket delete ownership** — `TICKET_DELETE` permission check is in `TicketService.delete()`, not in route middleware. Users with `user` role can delete their own tickets but not others'.
- **`user` role has limited permissions** — cannot create projects, manage users, manage agents, or approve/reject. Self-registration creates `project_admin` accounts.
- **`APPROVAL_VIEW` restricted to `super_admin`** — only super_admin can access `GET /api/approvals`.
- **`/api/auth/me`** returns `userId` (from JWT payload) instead of `id` in the user object.

## Feature Modules

### Agent Orchestration (rs-16)
Single-agent ticket lock with status-based workflow. Tickets have `assigned_agent_id` and `locked_at`. Stale tickets can be recovered.
Key: `services/TicketService.js`, `services/MessageService.js`, `middleware/ticketOwnership.js`, `controllers/ticketController.js`.

### Secure API Keys (rs-15)
Project credentials stored encrypted with AES-256-GCM in `project_credentials`. Keys masked in responses (last 4 chars visible).
Key: `services/CredentialService.js`, `controllers/credentialController.js`.

### Cost Tracking (rs-17)
Per-model pricing (Anthropic 4 models, OpenAI 5 models). Usage logs track provider, model, tokens, cost, duration. Daily billing aggregation.
Key: `utils/pricing.js`, `services/UsageLogger.js`, `services/BillingService.js`.

### Shared Agent Memory (rs-19)
Agents share context via `agent_memory` table with pgvector extension. HNSW index for semantic search. OpenAI-compatible embeddings.
Key: `services/MemoryService.js`, `controllers/memoryController.js`.

### Java Agent Application (rs-18)
Self-contained Java 17 Maven project. Agents poll for tickets, use AI providers, create Git branches/PRs, update ticket status.
Key: `agent/src/main/java/com/vibecode/agent/`, `agent/build.sh`, `agent/Dockerfile`.

## Frontend Unit Tests (132 tests, 8 files)

All in `frontend/src/__tests__/`: `client.test.js`, `auth.test.js`, `agents.test.js`, `tickets.test.js`, `auth-store.test.js`, `projects.test.js`, `users.test.js`, `approvals.test.js`. Pattern: `frontend/src/__tests__/<module>.test.js` mirroring backend convention.

## OpenAPI Contract (145 tests, 9 files)

Backend generates OpenAPI 3.0.3 spec from JSDoc annotations via `swagger-jsdoc`. Swagger UI served at `/api/docs`, raw spec at `/api/openapi.json`.

**Backend:**
- `backend/src/api/openapi-spec.js` — spec generator, defines schemas (User, Project, Ticket, Agent, Error, ApiResponse)
- All route files have `@openapi` JSDoc annotations (methods, params, responses, security)
- Dependencies: `swagger-jsdoc`, `swagger-ui-express`

**Frontend:**
- `frontend/src/api/generated/` — TypeScript types and models auto-generated from OpenAPI spec
- `frontend/src/api/validator.ts` — runtime response validation using OpenAPI schemas
- `frontend/src/__tests__/api-contract.test.ts` — 13 contract tests that catch field mismatches (e.g., `isActive` vs `is_active`)

**Workflow:**
```bash
# After changing backend routes:
cd frontend && npm run generate:spec && npm run generate:api

# Run contract tests:
cd frontend && npm test -- --run src/__tests__/api-contract.test.ts
```

**Contract tests detect:**
- Missing required fields
- Wrong field names (snake_case vs camelCase mismatches)
- Invalid enum values
- Malformed response structure (missing `success`/`data` fields)

**Generated models:** `User` (id, name, email, role, isActive, currentPlan, created_at, updated_at), `Project` (id, name, description, owner_id, created_at, updated_at), `Ticket` (id, title, description, status, priority, owner_id, project_id, created_at, updated_at), `Agent` (id, name, user_id, api_key, is_active, created_at)
