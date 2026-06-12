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
  controllers/          → Controllers (ticket, project, user, agent, credential, usage, billing, memory)
  api/routes.js         → All route mounting (/health, /auth, /projects, /tickets, /agents, /credentials, /usage, /billing, /memory)
  api/{projects,tickets,agents,pricing,user,credentials,usage,billing,memory}.js  → route modules
  services/{Project,Ticket,Agent,User,Permission,Credential,UsageLogger,BillingService,MessageService,MemoryService}.js  → business logic
  services/TicketService.js  → agent orchestration (pickUpTicket, releaseTicket, enforceOwnership, recoverOrphanedTickets)
  models/{user,project,ticket}.js  → DB models (soft delete, transaction support)
  utils/pricing.js      → per-model pricing (Anthropic + OpenAI)
 middleware/auth.js     → verifyToken, agentAuth, rateLimiter, requireActiveUser
   middleware/ticketOwnership.js → requireTicketOwnership, getTicket
   middleware/validate.js → Joi validation middleware
   middleware/errorHandler.js → Error handling middleware
   middleware/requestLogger.js → Request logging middleware
   middleware/permissions.js → Permission middleware (requireAnyPermission, requireAllPermissions)
   validators/            → Joi schemas (auth, projects, tickets, users)
   auth.js                → AuthService (register/login/token)
   db.js                  → pg Pool
   services/PermissionService.js → Permission resolution with in-memory cache
   api/permissions.js     → GET /api/permissions/:roleName
   migrations/apply.js    → runs 001_create_tables.sql through 015_shared_agent_memory.sql
 agent/                  → Java-based AI Agent (rs-18 Compute Profiles)
   src/main/java/com/vibecode/agent/ → AgentApp, config, model, service packages
   Dockerfile, docker-compose.yml, build.sh, .env.example
 frontend/src/
   router/index.ts        → nested routes, localStorage-based auth guard
   stores/auth.js         → Pinia store, tokens in localStorage (keys: vibecode_token, vibecode_user)
   views/{Login,Register,ProjectList,ProjectDetail,TicketBoard,TicketDetail,AIAssistant}.vue
    stores/auth.js         → Pinia store, tokens/permissions in localStorage
    components/{TicketEditModal,UserModal}.vue
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
| Frontend cypress:component | `npm run cypress:component` | Cypress component tests (headless) |
| Frontend cypress:e2e | `npm run cypress:e2e` | Cypress E2E tests (headless, needs backend) |
| Frontend cypress:all | `npm run cypress:all` | All Cypress tests |
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

Covers: health check, user registration/login, project CRUD, ticket CRUD, all status transitions (valid + invalid), agent creation, frontend SPA serving, auth enforcement, permission-based access control.

## Test Summary

- **Backend unit tests**: 400 passing (26 suites)
- **Backend integration tests**: 80 passing (Jest + curl Docker)
- **Frontend**: lint passes, typecheck passes, build succeeds
- **Total**: 480 tests passing, 0 failures

### Recent Feature Tests
- **rs-19 Shared Agent Memory**: 30 tests (memoryService.test.js, memoryController.test.js)
- **rs-17 Cost Tracking**: 20 tests (pricing.test.js, usageLogger.test.js, billingService.test.js, usageController.test.js, billingController.test.js)
- **rs-16 Agent Orchestration**: 32 tests (messageService.test.js, ticket_ownership.test.js, ticket_ownership_controller.test.js)
- **rs-15 Secure API Keys**: 16 tests (credentialService.test.js, credentialController.test.js)

## CI (`.github/workflows/ci.yml`)

- **Backend**: lint → test → `node --check src/index.js` (runs on ubuntu-latest with postgres:15 service)
- **Frontend**: lint → typecheck → build
- Both run on `main` and `develop` branches + PRs

## Test Quirks

- **Jest test match** (`backend/jest.config.js`): `**/__tests__/unit.test.js`, `**/__tests__/*.test.js`, `<rootDir>/src/middleware/*.test.js`. Not `**/*.test.js` — top-level `.test.js` files are NOT picked up.
- **Validation tests** (`src/__tests__/validation.test.js`): 50+ tests for Joi schemas and validation middleware, covers auth, projects, tickets, users schemas.
- **Permission tests** (`src/__tests__/permissions.test.js`, `src/middleware/permissions.test.js`): Tests for permission middleware, PermissionService, role-permission mappings.
- **Role system tests** (`src/__tests__/role-system.test.js`): Tests for UserService, AuthService, ApprovalService, TicketService.delete() with PermissionService mocks.
- **Jest mocks** (`src/__tests__/jest.setup.js`): `pg`, `winston`, `bcryptjs`, `uuid`, `jsonwebtoken`, `PermissionService` are fully mocked. Tests do NOT need a real database.
- **Jest config**: `forceExit: true`, `restoreMocks: false`, `testTimeout: 10000`.
- **`src/__tests__/db.mocks.js`**: alternate mocks for files that import models directly.
- **Integration tests** (`npm run test:integration`): uses `jest.integration.config.js`, skips mocks, connects to real PostgreSQL via `DATABASE_URL` (hardcoded to `postgresql://testuser:testpass@localhost:5432/vibecode`). Migrations run automatically via `src/__tests__/integration/setup.js`. Tests in `src/__tests__/integration/docker.test.js`.
- **Full integration tests** (`backend/integration-test/run.sh`): 80 tests covering health, auth, CRUD, status transitions, agents, permissions, frontend SPA serving.
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
Agents authenticate via `X-API-Key` header. The middleware in `middleware/auth.js` checks `apiKey.startsWith('test-')` or `apiKey === 'mock-agent-key'`. Agent endpoints in `api/agents.js` accept user JWT OR agent API key. Agents are users with `is_agent` boolean flag and `agent_roles` array (planner, worker, reviewer, approver) stored in the `users` table.

### Frontend auth persistence
Token, user, and permissions stored in `localStorage` as `vibecode_token`, `vibecode_user`, and `vibecode_permissions`. Route guards in `router/index.ts` check `localStorage.getItem('vibecode_token')` — no Pinia dependency. Auth store exposes permission helpers: `canCreateTicket()`, `canDeleteTicket()`, `canUpdateTicket()`, `canCreateUser()`, `canDeleteUser()`, `canToggleUser()`, `canAccessUsers()`, etc.

### Permission System
Replaced scattered role checks with granular, database-driven permissions. Roles map to permissions in DB, code checks `hasPermission('PERM_CODE')`.

**26 Permissions** (RESOURCE_ACTION format):
- `TICKET_CREATE`, `TICKET_READ`, `TICKET_UPDATE`, `TICKET_DELETE`, `TICKET_STATUS_CHANGE`, `TICKET_COMMENT`
- `PROJECT_CREATE`, `PROJECT_READ`, `PROJECT_UPDATE`, `PROJECT_DELETE`, `PROJECT_MANAGE_MEMBERS`
- `USER_CREATE`, `USER_READ`, `USER_UPDATE`, `USER_DELETE`, `USER_TOGGLE_ACTIVE`, `USER_VIEW_ALL`
- `AGENT_CREATE`, `AGENT_READ`, `AGENT_DELETE`, `AGENT_REVOKE`
- `APPROVAL_APPROVE`, `APPROVAL_REJECT`, `APPROVAL_VIEW`
- `PRICING_READ`, `DASHBOARD_READ`

**4 Roles** with permission mappings:
- `user` (9 perms): TICKET_CREATE/READ/UPDATE/STATUS_CHANGE/COMMENT, PROJECT_READ, AGENT_READ, PRICING_READ, DASHBOARD_READ
- `member` (18 perms): user perms + TICKET_DELETE, USER_CREATE/READ, APPROVAL_APPROVE/REJECT
- `project_admin` (20 perms): member perms + PROJECT_CREATE/UPDATE/DELETE/MANAGE_MEMBERS, USER_TOGGLE_ACTIVE/DELETE, AGENT_CREATE/DELETE, APPROVAL_VIEW
- `super_admin` (26 perms): all permissions

**Key files**:
- `backend/src/migrations/005_permission_system.sql` — DB schema (permissions, roles, role_permissions tables)
- `backend/src/services/PermissionService.js` — In-memory cached permission resolution
- `backend/src/middleware/permissions.js` — `requireAnyPermission(...codes)`, `requireAllPermissions(...codes)`
- `backend/src/api/permissions.js` — GET /api/permissions/:roleName
- `frontend/src/stores/auth.js` — Permission helpers, localStorage persistence (key: `vibecode_permissions`)

**Route-level checks** use permission middleware (e.g., `requireAnyPermission('TICKET_DELETE')`).
**Service-level checks** handle ownership (e.g., users can delete own tickets, admins can delete any).
**Frontend** fetches permissions on login/register, renders permission-based UI visibility.

### Database
PostgreSQL 15 in Docker, database `vibecode`. Migrations are ad-hoc SQL files executed sequentially — no migration tracking. `apply.js` runs `001_create_tables.sql`, `002_agents_schema.sql`, `003_role_system.sql`, `004_persistence_layer.sql`, `005_permission_system.sql`, `006_project_persistence.sql`, `007_user_roles.sql`, `008_agent_persistence.sql`, `009_agent_profiles.sql`, `010_project_credentials.sql`, `011_ticket_ownership.sql`, `012_agent_users.sql`, `013_usage_logs.sql`, `014_project_billing.sql`, and `015_shared_agent_memory.sql`.

### Port mapping
- **With override** (`docker-compose.override.yml` active): frontend `3000:80` (nginx serving built SPA)
- **Without override**: frontend `3002:80` (nginx serving built SPA)
- Backend always `3001:3001`
- PGAdmin always `5050:80`

### ESLint flat config
Both `backend/eslint.config.js` and `frontend/eslint.config.js` use flat config. Frontend uses `@typescript-eslint/parser` + `vue-eslint-parser` + `eslint-plugin-vue` for `.vue` files. Frontend lint catches unused vars, unused components, missing emit declarations, and more.

### Frontend Known Issues (not caught by lint)
The following issues exist in the frontend code and are NOT caught by the current lint rules. Fix them when working on the affected files:

- **`authStore.user` is a `ref`** — in script code, must access via `authStore.user.value`. Direct access (`authStore.user.role`) always returns `undefined`. [FIXED: Dashboard.vue, other files already correct]
- **`route.params.projectId` is always undefined** — router param is `id` (from `projects/:id/ai`), not `projectId`. Affects: `AIAssistant.vue` (loadAgentInfo, handleSubmit). [FIXED: already uses route.params.id]
- **Project selection in TicketBoard has no `@change` handler** — `v-model="selectedProjectId"` does not reload tickets. [FIXED: has @change="loadTickets(selectedProjectId)"]
- **Drag-drop in TicketBoard modifies throwaway object** — `handleDrop` receives `{id}` and modifies it instead of the real ticket in `tickets.value`. [FIXED: finds ticket from tickets.value array]
- **`+ New Ticket` button in TicketBoard is dead code** — sets `error = '...'` instead of creating a ticket. [FIXED: opens modal with working create form]
- **Comments in TicketDetail are never persisted** — `addCommentText()` only pushes to local `comments` ref. [FIXED: calls addComment API]
- **`ProjectDetail.vue` is an empty placeholder** — just `<h1>Project Detail</h1>`. [FIXED: serves as layout wrapper with router-view]

### Docker build
Backend: multi-stage (node:18-alpine). Frontend: multi-stage (node→nginx). Frontend container serves via nginx with SPA fallback (`try_files $uri $uri/ /index.html`).

### Docker compose startup order
The `migrate` service runs first (applies SQL migrations), then `api` starts (depends on migration completion), then `frontend`.

### Known Bugs / Gotchas
- **`static async fromRow()`** in `models/project.js` and `models/ticket.js` — must NOT be `async` (no `await` inside). An async `fromRow` returns a Promise, causing `findAll` to return `[{ }]` arrays. [FIXED: removed async keyword]
- **`docker-compose.override.yml`** frontend ports must be `3000:80` (host:container nginx port), not `3000:3000`.
- **Frontend nginx** may fail to start if the `api` upstream hostname isn't resolvable at startup. Restart the frontend container if it fails on first boot.
- **`UserService.authenticate()`** duplicates JWT signing logic that already exists in `auth.js` — both use `JWT_SECRET` but `UserService` also re-declares it locally. [FIXED: removed JWT signing from authenticate, auth.js handles token creation]
- **`/api/auth/me`** returns `userId` (from JWT payload) instead of `id` in the user object. [FIXED: queries database and returns user with `id` field]
- **Ticket delete ownership** — `TICKET_DELETE` permission check is in `TicketService.delete()`, not in route middleware. This allows users with `user` role to delete their own tickets while blocking deletion of others' tickets.
- **`user` role has limited permissions** — cannot create projects (`PROJECT_CREATE`), manage users (`USER_CREATE`, `USER_DELETE`, `USER_TOGGLE_ACTIVE`), manage agents (`AGENT_CREATE`, `AGENT_DELETE`), or approve/reject (`APPROVAL_APPROVE`, `APPROVAL_REJECT`). Self-registration creates `project_admin` role accounts.
- **`APPROVAL_VIEW` restricted to `super_admin`** — only super_admin can access `GET /api/approvals` (all approvals endpoint).

### Coding conventions (from `ai/CODING.md`)
- Use IPEE (Identify, Plan, Execute, Evaluate) for every change
- Plan 80% of effort before coding
- Add unit tests to all changes
- For breaking changes: create a branch, commit state, then change

### Ticket ownership & Agent orchestration (rs-16)
Single-agent ticket lock with status-based workflow. Tickets have `assigned_agent_id` and `locked_at` columns. Agents can pick up available tickets, release them, and coordinate via `ticket_messages` table. Stale tickets (locked beyond timeout) can be recovered by other agents.

**Key files**:
- `backend/src/migrations/011_ticket_ownership.sql` — ticket ownership columns + ticket_messages table
- `backend/src/migrations/012_agent_users.sql` — is_agent flag + agent_roles on users table
- `backend/src/services/MessageService.js` — postMessage, getTicketMessages, getUnreadMessages
- `backend/src/services/TicketService.js` — pickUpTicket, releaseTicket, enforceOwnership, recoverOrphanedTickets
- `backend/src/middleware/ticketOwnership.js` — requireTicketOwnership middleware
- `backend/src/controllers/ticketController.js` — agent orchestration endpoints
- `backend/src/api/tickets.js` — POST /:ticketId/pickup, POST /:ticketId/release, GET/POST /:ticketId/messages

### Secure API Keys (rs-15)
Project credentials (API keys, GitHub PATs) stored encrypted with AES-256-GCM in `project_credentials` table. Keys are masked in API responses (last 4 chars visible). Project admins can add, list, update, delete, rotate, and decrypt keys.

**Key files**:
- `backend/src/migrations/010_project_credentials.sql` — project_credentials table with encrypted storage
- `backend/src/services/CredentialService.js` — CRUD + rotate + decrypt operations
- `backend/src/controllers/credentialController.js` — 6 credential endpoints
- `backend/src/api/credentials.js` — routes under /credentials

### Cost Tracking (rs-17)
Per-model pricing for Anthropic (4 models) and OpenAI (5 models) with configurable fallback. Usage logs track provider, model, tokens, cost, duration per request. Daily billing aggregation for project admins.

**Key files**:
- `backend/src/utils/pricing.js` — per-model pricing
- `backend/src/migrations/013_usage_logs.sql` — usage_logs table
- `backend/src/migrations/014_project_billing.sql` — project_billing table (monthly aggregation)
- `backend/src/services/UsageLogger.js` — log(), getProjectUsage(), getUserUsage(), getTotalUsage()
- `backend/src/services/BillingService.js` — aggregateDailyBilling(), getProjectBilling(), getUserBilling()
- `backend/src/controllers/usageController.js` — project/user usage, model pricing
- `backend/src/controllers/billingController.js` — project/user billing
- `backend/src/api/usage.js` — routes under /usage
- `backend/src/api/billing.js` — routes under /billing

### Shared Agent Memory (rs-19)
Agents share context via `agent_memory` table with pgvector extension. HNSW index enables fast semantic search. OpenAI-compatible embeddings (text-embedding-3-small) for vector generation. Memory is scoped to projects and individual agents.

**Key files**:
- `backend/src/migrations/015_shared_agent_memory.sql` — agent_memory table with pgvector + HNSW index
- `backend/src/services/MemoryService.js` — addMemory, getMemory, searchSimilar, updateMemory, deleteMemory
- `backend/src/controllers/memoryController.js` — 7 memory endpoints
- `backend/src/api/memory.js` — routes under /memory (project/agent scoped, semantic search)

### Java Agent Application (rs-18)
Self-contained Java 17 Maven project for compute nodes. Agents poll for tickets, use AI providers (Claude/OpenAI) to generate code, create Git branches/PRs, and update ticket status. Docker containers with self-registration and heartbeat.

**Key files**:
- `agent/pom.xml` — Maven config (Java 17, OkHttp, Jackson, JUnit 5)
- `agent/src/main/java/com/vibecode/agent/AgentApp.java` — Main entry with polling loop
- `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` — Core orchestration
- `agent/src/main/java/com/vibecode/agent/service/AiProvider.java` — Provider interface
- `agent/src/main/java/com/vibecode/agent/service/ClaudeProvider.java` — Claude/Anthropic implementation
- `agent/src/main/java/com/vibecode/agent/service/OpenAiProvider.java` — OpenAI implementation
- `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` — GitHub REST API client
- `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` — Env var config loader
- `agent/Dockerfile` — Multi-stage build
- `agent/docker-compose.yml` — Agent service definition
- `agent/build.sh` — Build script (auto-install Java/Maven, compile, test)
- `agent/.env.example` — Environment variable template

### Frontend Unit Tests — ✅ COMPLETED (132 tests, 8 files)

Frontend now has **132 Vitest unit tests** across 8 files, covering all pure logic functions.

**Test files** (all in `frontend/src/__tests__/`):
1. `client.test.js` — 14 tests for HTTP client wrapper (fetch, headers, 401 handling)
2. `auth.test.js` — 12 tests for register/login response extraction
3. `agents.test.js` — 12 tests for agent API endpoints and HTTP methods
4. `tickets.test.js` — 16 tests for ticket CRUD and error propagation
5. `auth-store.test.js` — 44 tests for Pinia store (state, permissions, sync)
6. `projects.test.js` — 11 tests for project CRUD operations
7. `users.test.js` — 18 tests for user management API (list, create, update, toggle, delete)
8. `approvals.test.js` — 5 tests for approval workflow endpoints

**Pattern**: `frontend/src/__tests__/<module>.test.js` mirroring backend convention.

**See**: `ARCHITECT/frontend-unit-tests.md` for the detailed plan.
