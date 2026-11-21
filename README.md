# Vibecode AI Planner

AI-powered Kanban SaaS for managing development tasks with integrated AI agents.

**Tech stack:** Node.js/Express (backend) · Vue 3 + Vite + Pinia (frontend) · Java 17 Maven (agent compute nodes) · PostgreSQL 15 · Redis 7

## Quick Start

### Prerequisites

- Node.js 24 LTS (`nvm use` reads `.nvmrc`; Node 18 is no longer supported)
- Docker & Docker Compose (v2, `docker compose` subcommand)
- Java 17+ (optional, for agent compute nodes)

### Bootstrap and verification

On a fresh checkout:

```bash
bash scripts/bootstrap-local.sh   # Node from .nvmrc, npm ci, Cypress binary
bash scripts/verify-local.sh      # local Node/Java checks (not the full Jenkins pipeline)
```

`verify-local.sh --quick` skips coverage and the Java agent tests. It does not
run Docker integration, Cypress, agent packaging/image or sandbox checks; run
the Jenkins pipeline or the dedicated commands for those.

### Docker Setup (Recommended)

```bash
# Root .env and .env.local are gitignored. Start from the example:
cp .env.example .env.local   # edit .env.local with your values

# Dev mode — frontend :3000, API :3001, PG :5432
docker compose --env-file .env.local up --build

# Production-style — frontend :3002, API :3001
docker compose --env-file .env.local -f docker-compose.yml up --build

# With PgAdmin (dev only) — available at :5050
docker compose --env-file .env.local --profile dev up --build
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
# Start infrastructure (password must match the backend DATABASE_URL below)
docker compose --env-file .env.local --profile dev up postgres redis

# Activate the Node version from .nvmrc
nvm use

# Backend
cd backend
cp .env.example .env        # configure .env
npm ci
npm run db:migrate           # run database migrations
npm run dev                  # API :3001, uses `node --watch`

# Frontend (new terminal)
cd ../frontend
cp .env.example .env.local   # configure .env.local
npm ci
npx cypress install          # npm 11 does not run Cypress's download script
npm run dev                  # Vite :3000, proxies /api → :3001

# Agent (new terminal, Java 17 required)
cd ../agent
cp .env.example .env
mvn package -DskipTests
java -jar target/agent-1.0.0.jar
```

`POSTGRES_PASSWORD` in the root `.env.local` and the password in
`backend/.env`'s `DATABASE_URL` must match (`changeme` in the examples).
Local Cypress needs Chrome/Chromium and Xvfb; `bootstrap-local.sh` reports
both, and the Docker Cypress image is the fallback when they are unavailable.

## Environment Variables

### Root `.env.local` (Docker)

Required for `docker compose --env-file .env.local up`:

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
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:changeme@localhost:5432/vibecode` |
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
| `PROVIDER_DEFAULT_TEMPERATURE` | Sampling temperature for registry-resolved providers (empty/invalid → 0.1) | `0.1` |
| `GITHUB_AUTH_MODE` | `app` (GitHub App installation tokens) or `pat` | `app` |
| `GITHUB_APP_ID` | GitHub App id | _(app mode)_ |
| `GITHUB_APP_PRIVATE_KEY` | PEM value, `\n`-escaped PEM, or `file:/path/to/key.pem` | _(app mode)_ |
| `GITHUB_APP_INSTALLATION_ID` | Single-tenant/dev installation fallback | _(none)_ |
| `GITHUB_TOKEN_TTL_SECONDS` | Client-side cap for installation tokens (60–3600) | `3600` |
| `ALLOW_PAT` | Enables the stored-PAT fallback in `pat` mode | `false` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `REDIS_PREFIX` | Redis key prefix | `vibecode:` |
| `METRICS_TOKEN` | Auth token for `/metrics` endpoint | _(none = no auth)_ |
| `LOG_LEVEL` | Winston log level | `info` |
| `AGENT_ENROLLMENT_ENABLED` | Enable join-token mint/enroll/refresh (`1`/`true`) | `false` (dev Compose: `true`) |
| `AGENT_ENROLLMENT_TOKEN_TTL_SECONDS` | Join-token lifetime | `900` |
| `AGENT_ACCESS_TOKEN_TTL_SECONDS` | Node access-token lifetime | `3600` |
| `AGENT_REFRESH_TOKEN_TTL_DAYS` | Refresh-token lifetime | `30` |
| `AGENT_REFRESH_REPLAY_CACHE_SECONDS` | Idempotent refresh replay window | `60` |
| `ALLOW_INSECURE_AGENT_ENROLLMENT` | Allow non-TLS enrollment for local testing | `0` |
| `TRUST_PROXY` | Express trust proxy: `1` (one hop), `true`, or IP/CIDR list | _(unset)_ |
| `POOL_AGENT_KEY_EXPIRY_DAYS` | Pool-agent static key lifetime | `30` |

### Frontend `.env.local`

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:3001` |

### Agent `.env` (Java)

See [`agent/ENROLLMENT.md`](agent/ENROLLMENT.md) for the full self-enrollment walkthrough, and [`agent/README.md`](agent/README.md) for deployment topologies, auth/repo modes and the build/run commands. The agent reads the project's connected repository from the backend at startup
when `AGENT_MODE=build`; `REPO_OWNER`/`REPO_NAME` are then only a fallback.
Review-only nodes use `AGENT_MODE=review`. `AGENT_MODE=auto` keeps the legacy
behavior: an env repo pair means build, otherwise review, so a build node that
relies only on the server repo must set `AGENT_MODE=build`. The remote template
defaults to `build`; the standalone Compose file defaults to `auto`. Restart
the agent after changing the project's repo in the UI.

For a remote node, mint a one-time join token in **Agents → Enrollment**, set
`ENROLLMENT_TOKEN` and a persistent `AGENT_CREDENTIALS_FILE` volume, and leave
`AGENT_ID`/`AGENT_API_KEY` unset. The node enrolls on first boot, stores its own
access/refresh credentials (`0600`) and refreshes automatically. Enrollment
requires HTTPS outside loopback; `ALLOW_INSECURE_AGENT_ENROLLMENT=1` is for
local testing only. Deleting the credential volume requires a new join token.

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_ID` | Static agent id (legacy pair with `AGENT_API_KEY`) | _(required for legacy)_ |
| `AGENT_API_KEY` | Static API key for backend auth | _(required for legacy)_ |
| `AGENT_AUTH_MODE` | `auto`, `legacy` or `enroll`; `auto` prefers a static pair and enrolls when it is absent | `auto` |
| `ENROLLMENT_TOKEN` | One-time `enr_…` join token minted in Agents → Enrollment | _(none)_ |
| `ENROLLMENT_URL` | Override the enrollment endpoint (defaults to `BACKEND_URL` + `/api/v1/agent-nodes/enroll`) | _(derived)_ |
| `AGENT_CREDENTIALS_FILE` | Persistent credential file for enrolled nodes; the file wins over `ENROLLMENT_TOKEN` on restart | _(none)_ |
| `BACKEND_URL` | Backend API URL | `http://localhost:3001` |
| `PROJECT_ID` | Project to work on | `1` |
| `AGENT_MODE` | `auto` (env repo pair = build), `build` (project repo; fail if none), `review` | `auto` |
| `REPO_OWNER` | Build fallback; the project's configured repository takes precedence with `AGENT_MODE=build` | _(optional)_ |
| `REPO_NAME` | Build fallback; the project's configured repository takes precedence with `AGENT_MODE=build` | _(optional)_ |
| `AI_PROVIDER` | AI provider (`claude`, `openai`, `opencode`, `opencode-go`, `generic`, `custom`, `ollama`, `vllm`, `llamacpp`) | `claude` |
| `AI_MODEL` | AI model | `claude-sonnet-4-20250514` |
| `AI_API_KEY` | AI provider API key | _(required)_ |
| `AI_ENDPOINT_URL` | OpenAI-compatible endpoint; required for `generic`/`custom`/`ollama`/`vllm`/`llamacpp` and for an OpenCode agent when no backend provider config is available | _(provider default)_ |
| `POLL_INTERVAL_MS` | Polling interval | `30000` |
| `STALE_TIMEOUT_MS` | Agent stale timeout | `3600000` |
| `DRY_RUN` | Dry run mode | `false` |
| `MAX_TICKETS` | Max tickets per cycle | `1` |
| `HARNESS_BIN` | OpenCode executable | `opencode` |
| `HARNESS_STARTUP_TIMEOUT_MS` | OpenCode server health timeout | `30000` |
| `HARNESS_MAX_DURATION_MINUTES` | Per-ticket wall-clock budget, enforced per install/verify command and before publish | `45` |
| `HARNESS_VERIFY_COMMANDS` | Semicolon-separated verification commands (empty = autodetect, then fail closed) | _(autodetect)_ |
| `HARNESS_PROTECTED_PATHS` | Semicolon-separated globs that must never be published | `.env*;**/.env*;Jenkinsfile;**/Jenkinsfile;.github/**;**/.github/**;**/secrets/**` |
| `HARNESS_MODEL` | Optional harness model override (must match the configured provider) | _(provider default)_ |
| `HARNESS_MAX_FILES` | Maximum changed files the guard will publish | `50` |
| `HARNESS_MAX_LINES` | Maximum changed lines the guard will publish | `2000` |
| `HARNESS_MAX_BYTES` | Maximum total added + removed content bytes the guard will publish | `5242880` |
| `HARNESS_FSCK` | Run `git fsck --strict` before staging (`false` skips it for very large repos) | `true` |
| `HARNESS_LEASE_SECONDS` | Ticket lease TTL for durable runs (clamped 60–86400) | `600` |
| `HARNESS_HEARTBEAT_SECONDS` | Lease renewal and heartbeat interval (clamped to ≤ lease/2) | `30` |
| `HARNESS_DURABILITY_REQUIRED` | Fail closed if the initial harness run cannot be persisted | `false` |
| `HARNESS_RESUME_MODE` | Startup recovery policy: `restart` or `resume` (adopt published evidence) | `restart` |
| `HARNESS_REAPER_INTERVAL_SECONDS` | Sweep interval for expired leases / orphaned runs; `0` disables | `60` |
| `HARNESS_WORKSPACE_RETENTION_HOURS` | Agent-side stale clone cleanup at startup; `0` disables | `24` |
| `HARNESS_RETRY_PIN_ATTEMPTS` | Failures before the run is marked `dead_letter` for manual recovery (the ticket stays in_progress; `HARNESS_MAX_ATTEMPTS` is accepted as a legacy alias) | `3` |
| `HARNESS_RETRY_BASE_DELAY_MS` | Base exponential retry delay | `60000` |
| `HARNESS_RETRY_MAX_DELAY_MS` | Maximum retry delay | `3600000` |

The agent starts an isolated OpenCode server session (`opencode serve`), lets it
read/edit/test the cloned workspace, then verifies and publishes the diff itself. The harness is *denied* commit/push/merge by policy
and the supervisor owns publishing, but bash rules are defense-in-depth rather
than a security boundary: the supervisor also sanitizes child environments,
disables project config (`OPENCODE_DISABLE_PROJECT_CONFIG`), restores a trusted
`.git/config` before publishing, disables hooks, and parses `git status -uall -z`
so untracked directories cannot hide protected files.

The harness requires OpenCode 1.x (the Docker image pins `1.19.5`). A local
`opencode` from `PATH` must speak the v1 server API.

Verification and harness children receive proxy/registry variables only after
URL userinfo is stripped, and `MAVEN_OPTS` is not inherited. Authenticated
enterprise proxies must therefore be configured at the network/container layer
rather than through supervisor credentials. Private npm registries follow the
same rule: prefer a pull-only registry proxy for untrusted sandboxes; a mounted
`.npmrc` must be read-only and pull-only, and registry tokens must not enter the
supervisor environment.

### Runtime Flags

| Variable | Where | Description |
|----------|-------|-------------|
| `METRICS_TOKEN` | Backend | If set, `/metrics` endpoint requires `X-Metrics-Token` header. If unset, no auth required. |
| `NODE_ENV=test` | Backend | Skips server listen; supertest uses the app directly. Also disables Prometheus default metrics collection. |

### Health Check Logging

Docker health checks use `wget --spider` (frontend) and `curl -f` (backend) to avoid noisy access logs. Health check endpoints (`/api/health`, `/api/version`) are automatically skipped by the backend request logger. The `docker-proxy` service logs are from a third-party image and cannot be suppressed from this project.

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
│   ├── migrations/         → 47 SQL files + 2 data migrations
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
└── .env.example            → Root env template (copy to .env.local)
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
docker compose --env-file .env.local up --build                        # Dev mode
docker compose --env-file .env.local -f docker-compose.yml up --build  # Production ports
docker compose --env-file .env.local --profile dev up                  # Includes PgAdmin
docker compose --env-file .env.local down -v                           # Stop and remove volumes
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
| GET/POST/PATCH | `/api/v1/agent-nodes/*` | JWT / node token | Node fleet management, enrollment and runtime heartbeat |
| POST | `/api/v1/providers/resolve` | JWT | Resolve a verified registry model by role or phase |

**Auth:**
- User auth: JWT via `Authorization: Bearer <token>` header
- Node/runtime auth: `X-API-Key` with a node access token plus `X-Agent-Runtime`; legacy static agent API keys are removed

**Rate limiting:**
- `/api/auth/register`: 3 requests per 60 seconds
- `/api/auth/login`: 5 requests per 60 seconds, lockout after 10 failures (15 min)
- `/api/auth/me`: 30 requests per 60 seconds

**Provider resolution:** `POST /api/v1/providers/resolve` selects a verified registry model by `role` (`worker`/`reviewer`/`planner`) or `phase` (`planning`→planner, `review`→reviewer, otherwise worker). Legacy `labels`/`priority` fields are ignored; fg-38 owns routing policy.

**Ticket status transitions:** `backlog → in_progress → review → done` (review can go back to backlog, in_progress can go back to backlog). `done` is terminal.

**Permissions:** 26 permissions across 4 roles: `user` (9), `member` (18), `project_admin` (20), `super_admin` (26).

## Testing

### Backend (Jest)

- Test files: `src/__tests__/*.test.js` + `src/middleware/*.test.js`
- `setupFilesAfterEnv`: `src/__tests__/jest.setup.js` — mocks pg, winston, bcryptjs, uuid, jsonwebtoken
- Integration tests: `jest.integration.config.js` — real PG, `maxWorkers:1`
- Bash integration suite: `integration-test/run.sh` — curl against Docker containers

### Frontend (Vitest + Cypress)

- 66 unit test files / 574 tests in `src/__tests__/`
- 7 Cypress E2E specs + 7 component specs in `cypress/`
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

Jenkins (`Jenkinsfile`):

```
backend job:   npm ci → lint → syntax check → unit test → coverage
frontend job:  npm ci → lint → typecheck → unit test → coverage → build
contract test: vitest run api-contract.test.ts (after backend + frontend)
cypress:       docker compose (e2e overlay) → cypress/included runs e2e + component
integration:   docker compose up → Jest integration tests → bash integration tests
agent job:     mvn test → package → agent image build
sandbox job:   build sandbox/proxy images → real-Docker integration suite
cleanup job:   Jenkinsfile.cleanup → label/age-scoped orphan GC (dedicated host)
```

The full pipeline runs on every build; no stages are skipped by change
detection. The backend job uses a real PostgreSQL service container. If Jenkins
runs in a container, `agent/scripts/sandbox-ci-env.sh` maps the workspace to the
Docker host path; set `JENKINS_HOST_HOME` when the mount cannot be discovered
(the identity fallback warns). It only maps workspaces under `JENKINS_HOME`; a
workspace outside that root is left unchanged.

BP-135 adds a scoped cleanup path. The pipeline tears down its own Compose
project before `cleanWs()` and removes only its job/build image tag; Compose
project names include the branch, job and build, and post cleanup is scoped by
`CI_JOB` plus the build ID because build numbers are unique only within a job.
The scheduled `Jenkinsfile.cleanup` job (pinned to the `vibecode-ci-docker`
node) is job-agnostic and removes only positively labelled, age-scoped
resources.
`CI_IMAGE_GRACE_HOURS` (default 24), `CI_CONTAINER_GRACE_HOURS` (2) and
`CI_BUILD_GRACE_HOURS` (6) control retention. Cleanup never runs a broad
`docker system prune`, never removes the local-dev `vibecoder-ai-planner`
project, shared volumes or the shared `:ci` image aliases. See
`planning/DONE/bp-135-ci-docker-resource-cleanup/05_RUNBOOK.md` for provisioning,
the one-time legacy inventory and rollback.

### GitHub App credentials (fg-35)

Publishing uses a repo-scoped GitHub App installation token by default. The
agent requests it from `POST /api/v1/github/:projectId/token`, keeps it in
memory and refreshes it before expiry; it is never written to `.git/config`,
argv, logs or the model prompt. Projects are mapped to an installation with
`PUT /api/v1/github/:projectId/installation`. The stored PAT is only used when
both the backend and agent set `GITHUB_AUTH_MODE=pat` and `ALLOW_PAT=true`
(local development). See
`planning/DONE/fg-35-github-app-credentials/05_RUNBOOK.md` for registration,
rotation, revocation and rollback.

## Planning

Planning suites live in `planning/`:
- `bp-XX-*` — Bug fixes / improvements
- `bt-XX-*` — Test backfill
- `fg-XX-*` — Feature groups
- `DONE/` — Completed suites
- `archived/` — Archived suites
- `PENDING.txt` — Active ticket queue (canonical)

Each suite follows templates: `00_ARCHITECT_CHECKLIST.md` → `01_ARCHITECT_REQUIREMENT.md` → `02_ARCHITECT_DESIGN.md` → `03_ARCHITECT_IMPLEMENTATION.md` → `04_SPECIFICATION.md` (optional) → `05_RUNBOOK.md` (optional). Small, single-layer tickets use the lightweight `00` + `03` templates in `planning/lightweight/`. See `planning/README.md` for document ownership and rules, and `planning/ENGINEERING_STANDARDS.md` for repo-wide engineering conventions.

The review policy defines the target formal gates before merge: deterministic check → **pre-implementation risk review** (assumptions, failure modes, security considerations, change impact) → independent review → fixer → **requirement traceability** (requirement → code → test → verification evidence) → human approval. The risk review is owned by `fg-45`; traceability is owned by `fg-51`. Layers 2 and 6 are policy targets until those tickets land; until then they are applied manually.

## Migration System

Migrations are SQL files in `backend/src/migrations/`, applied by `src/migrations/apply.js` in **array order** (not numeric). Notable ordering:
- 011/012 appear after 014
- 020 appears after 018 (no 019)
- 029 and 031 each have two files

Each migration has a `_rollback.sql` counterpart.

## Contributing

1. Read `AGENTS.md` for full guidelines and gotchas
2. Read `ai/CODING.md` for coding principles
3. Check `planning/TICKETS.txt` for active work
4. Check `PENDING.txt` for unimplemented planning suites
5. Scan `Out of Scope` sections in `planning/DONE/` for deferred improvements (goldmine)
6. Ensure all tests pass before pushing
7. Every fix must include a regression test

## License

MIT
