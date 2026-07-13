# Vibecode AI Planner

AI-powered Kanban SaaS for managing development tasks with integrated AI agents.

**Tech stack:** Node.js/Express (backend) · Vue 3 + Vite + Pinia (frontend) · Java 17 Maven (agent compute nodes) · PostgreSQL 15 · Redis 7

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (v2, `docker compose` subcommand)
- Java 17+ (optional, for agent compute nodes)

### Docker Setup (Recommended)

```bash
# Copy and configure environment variables
cp .env .env.local   # edit .env.local with your values

# Dev mode — frontend :3000, API :3001, PG :5432
docker compose up --build

# Production-style — frontend :3002, API :3001
docker compose -f docker-compose.yml up --build

# With PgAdmin (dev only) — available at :5050
docker compose --profile dev up --build
```

**Service URLs:**

| Service | Dev | Production |
|---------|-----|------------|
| Frontend | http://localhost:3000 | http://localhost:3002 |
| Backend API | http://localhost:3001 | http://localhost:3001 |
| PostgreSQL | localhost:5432 | localhost:5432 |
| PgAdmin | localhost:5050 | N/A |
| API Docs | http://localhost:3001/api/docs | http://localhost:3001/api/docs |

### Manual Setup

```bash
# Start infrastructure
docker compose --profile dev up postgres redis

# Backend
cd backend
cp .env.example .env        # configure .env
npm install
npm run db:migrate           # run database migrations
npm run dev                  # API :3001, uses `node --watch`

# Frontend (new terminal)
cd ../frontend
cp .env.example .env.local   # configure .env.local
npm install
npm run dev                  # Vite :3000, proxies /api → :3001

# Agent (new terminal, Java 17 required)
cd ../agent
cp .env.example .env
mvn package -DskipTests
java -jar target/agent-1.0.0.jar
```

## Environment Variables

### Root `.env` (Docker)

Required for `docker compose up`:

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | PostgreSQL password | `changeme` |
| `JWT_SECRET` | JWT signing secret | `super-secret-key-change-in-production-use-envsubst` |
| `PGADMIN_PASSWORD` | PgAdmin password | `changeme` |
| `ENCRYPTION_KEY` | 64 hex chars for AES-256 | `0123456789abcdef...` |

### Backend `.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `development` |
| `PORT` | API port | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/vibecode` |
| `JWT_SECRET` | JWT signing secret | _(required)_ |
| `TOKEN_EXPIRY_HOURS` | JWT token expiry | `24` |
| `DATABASE_POOL_MAX` | Max DB pool connections | `20` |
| `DATABASE_IDLE_TIMEOUT_MS` | Pool idle timeout | `30000` |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Connection timeout | `5000` |
| `DATABASE_MAX_USES` | Max connections uses before recycle | `10000` |
| `REQUEST_TIMEOUT_MS` | Request timeout | `30000` |
| `SLOW_REQUEST_THRESHOLD_MS` | Slow request log threshold | `5000` |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `http://localhost:3000,http://localhost:3002` |
| `DOCKER_API_URL` | Docker socket URL | `http://docker-proxy:2375` |
| `ENCRYPTION_KEY` | 64 hex chars for AES-256 | _(required)_ |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `REDIS_PREFIX` | Redis key prefix | `vibecode:` |
| `METRICS_TOKEN` | Auth token for `/metrics` endpoint | _(none = no auth)_ |
| `LOG_LEVEL` | Winston log level | `info` |

### Frontend `.env.local`

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:3001` |

### Agent `.env` (Java)

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_API_KEY` | API key for backend auth | _(required)_ |
| `BACKEND_URL` | Backend API URL | `http://localhost:3001` |
| `PROJECT_ID` | Project to work on | `1` |
| `REPO_OWNER` | GitHub org/user | _(required)_ |
| `REPO_NAME` | GitHub repo name | _(required)_ |
| `AI_PROVIDER` | AI provider | `claude` |
| `AI_MODEL` | AI model | `claude-sonnet-4-20250514` |
| `AI_API_KEY` | AI provider API key | _(required)_ |
| `POLL_INTERVAL_MS` | Polling interval | `30000` |
| `STALE_TIMEOUT_MS` | Agent stale timeout | `3600000` |
| `DRY_RUN` | Dry run mode | `false` |
| `MAX_TICKETS` | Max tickets per cycle | `1` |

### Runtime Flags

| Variable | Where | Description |
|----------|-------|-------------|
| `NGINX_HEALTH_LOG` | Frontend (Docker) | Set to `enabled` to show health check requests in access logs. Default: suppressed (`/dev/null`). |
| `METRICS_TOKEN` | Backend | If set, `/metrics` endpoint requires `X-Metrics-Token` header. If unset, no auth required. |
| `NODE_ENV=test` | Backend | Skips server listen; supertest uses the app directly. Also disables Prometheus default metrics collection. |

## Project Structure

```
vibecode/
├── backend/src/
│   ├── index.js            → Express app (exports for testing)
│   ├── api/
│   │   ├── routes.js       → /health, /version, /docs, /metrics, /auth/*, /v1/*
│   │   ├── v1/index.js     → 16 routers + inlined templates/attachments/planning
│   │   └── terminal.js     → WebSocket terminal proxy
│   ├── middleware/         → auth, permissions, validate (Joi), cors, rate limiter, CSP, requestId, error handler, timeout, slow request logger
│   ├── services/           → ~25 business logic services
│   ├── controllers/        → ~12 request handlers
│   ├── models/             → approval, project, ticket, user
│   ├── migrations/         → 37 SQL files + 2 data migrations
│   ├── validators/         → Joi schemas
│   ├── db.js               → pg Pool (DATABASE_URL)
│   └── utils/logger.js     → Winston logger
├── frontend/src/
│   ├── App.vue             → Root component with RateLimitBanner
│   ├── stores/             → Pinia stores (auth, rateLimit)
│   ├── api/
│   │   ├── client.js       → Native fetch (NOT axios)
│   │   └── generated/      → TS types via openapi-typescript-codegen
│   ├── router/             → Vue Router with auth guards
│   ├── views/              → Pages (Dashboard, ProjectDetail, TicketBoard, etc.)
│   └── components/         → Reusable components
├── agent/                  → Java 17 Maven, shaded JAR, eclipse-temurin Docker
├── planning/               → Planning suites (bp-XX/, bt-XX/, fg-XX/) + templates
│   ├── DONE/               → Completed planning suites
│   ├── archived/           → Archived planning suites
│   └── TICKETS.txt         → Active tickets
├── docker-compose.yml      → Production compose
├── docker-compose.override.yml → Dev overrides (ports, volumes)
└── .env                    → Root env (POSTGRES_PASSWORD, JWT_SECRET, etc.)
```

## Development Commands

### Backend (from `backend/`)

```bash
npm run dev          # node --watch src/index.js → :3001
npm start            # production start (no watch)
npm test             # Jest unit tests
npm run test:coverage # Jest with Istanbul coverage (60% threshold)
npm run test:integration # Real PG integration tests
npm run lint         # ESLint flat config
npm run db:migrate   # Apply migrations
npm run db:reset     # Same as migrate
npm run generate:spec # Generate OpenAPI spec from JSDoc
```

### Frontend (from `frontend/`)

```bash
npm run dev          # Vite :3000, proxies /api → :3001
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # ESLint
npm test             # Vitest (watch mode)
npm test -- --run    # Vitest (CI mode, no watch)
npm run test:coverage # Vitest with coverage (60% threshold)
npm run typecheck    # vue-tsc --noEmit (strict mode)
npm run generate:api # Generate TS API client from OpenAPI spec
npm run cypress:e2e  # Cypress E2E tests (headless)
npm run cypress:component # Cypress component tests
npm run cypress:all  # Run all Cypress tests
```

### Docker

```bash
docker compose up --build                        # Dev mode
docker compose -f docker-compose.yml up --build  # Production ports
docker compose --profile dev up                  # Includes PgAdmin
docker compose down -v                           # Stop and remove volumes
```

## API

All responses: `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }`

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Health check (DB connectivity) |
| GET | `/api/version` | None | API version info |
| GET | `/api/docs` | None | Swagger UI |
| GET | `/api/openapi.json` | None | Raw OpenAPI spec |
| GET | `/metrics` | Optional | Prometheus metrics (METRICS_TOKEN) |
| POST | `/api/auth/register` | None | Register (3/60s rate limit) |
| POST | `/api/auth/login` | None | Login (5/60s, lockout after 10 failures) |
| GET | `/api/auth/me` | JWT | Current user info |
| GET/POST | `/api/v1/projects/*` | JWT | Project CRUD |
| GET/POST/PUT/DELETE | `/api/v1/tickets/*` | JWT | Ticket CRUD + status transitions |
| GET/POST | `/api/v1/agents/*` | JWT/API Key | Agent management |
| GET | `/api/v1/agents/:id/heartbeat` | JWT/API Key | Agent heartbeat |

**Auth:**
- User auth: JWT via `Authorization: Bearer <token>` header
- Agent auth: `X-API-Key` header (mock keys: starts with `test-` or equals `mock-agent-key`)

**Rate limiting:**
- `/api/auth/register`: 3 requests per 60 seconds
- `/api/auth/login`: 5 requests per 60 seconds, lockout after 10 failures (15 min)
- `/api/auth/me`: 30 requests per 60 seconds

**Ticket status transitions:** `backlog → in_progress → review → done` (review can go back to backlog, in_progress can go back to backlog). `done` is terminal.

**Permissions:** 26 permissions across 4 roles: `user` (9), `member` (18), `project_admin` (20), `super_admin` (26).

## Testing

### Backend (Jest)

- Test files: `src/__tests__/*.test.js` + `src/middleware/*.test.js`
- `setupFilesAfterEnv`: `src/__tests__/jest.setup.js` — mocks pg, winston, bcryptjs, uuid, jsonwebtoken
- Integration tests: `jest.integration.config.js` — real PG, `maxWorkers:1`
- Bash integration suite: `integration-test/run.sh` — curl against Docker containers

### Frontend (Vitest + Cypress)

- 22+ unit test files in `src/__tests__/`
- 7 Cypress E2E specs + 5 component specs in `cypress/`
- Contract test: `src/__tests__/api-contract.test.ts`

### Coverage threshold (60%)

Both backend and frontend enforce a 60% minimum coverage (lines, functions, branches, statements) in CI.

### Bug fix protocol

Every fix **must** include a regression test:
- Route bugs: `supertest` in `src/__tests__/`
- Service/controller bugs: extend unit tests with existing Jest mocks
- Frontend bugs: extend Vitest tests in `src/__tests__/`

**Test order after fix:**
1. Layer you changed: `npm test` (backend) or `npm test -- --run` (frontend)
2. Other layer: `npm test -- --run` (frontend) or `npm test` (backend)
3. Integration: `npm run test:integration` → `bash backend/integration-test/run.sh`

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`):

```
backend job:  npm ci → lint → test → contract test → node --check src/index.js
frontend job: npm ci → lint → typecheck → build
```

Backend CI job runs a real PostgreSQL service container.

## Planning

The project uses an IPEE-based planning methodology (see `ai/CODING.md`):

1. **Identify** — define the problem, inputs, outputs, constraints
2. **Plan** — evaluate solutions (~80% planning, ~20% coding)
3. **Execute** — implement
4. **Evaluate** — test against expected outcomes

Planning suites live in `planning/`:
- `bp-XX-*` — Bug fixes / improvements
- `bt-XX-*` — Test backfill
- `fg-XX-*` — Feature groups
- `DONE/` — Completed suites
- `archived/` — Archived suites
- `TICKETS.txt` — Active tickets

Each suite follows templates: `00_ARCHITECT_CHECKLIST.md` → `01_ARCHITECT_REQUIREMENT.md` → `02_ARCHITECT_DESIGN.md` → `03_ARCHITECT_IMPLEMENTATION.md` → `04_SPECIFICATION.md`.

## Migration System

Migrations are SQL files in `backend/src/migrations/`, applied by `src/migrations/apply.js` in **array order** (not numeric). Notable ordering:
- 011/012 appear after 014
- 020 appears after 018 (no 019)
- 029 and 031 each have two files

Each migration has a `_rollback.sql` counterpart.

## Contributing

1. Read `AGENTS.md` for full guidelines and gotchas
2. Read `ai/CODING.md` for IPEE methodology
3. Check `planning/TICKETS.txt` for active work
4. Check `PENDING.txt` for unimplemented planning suites
5. Scan `Out of Scope` sections in `planning/DONE/` for deferred improvements (goldmine)
6. Ensure all tests pass before pushing
7. Every fix must include a regression test

## License

MIT
