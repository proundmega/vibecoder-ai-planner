# Vibecode AI Planner

AI-powered Kanban SaaS. Backend: Node.js/Express (CommonJS). Frontend: Vue 3 + Vite + Pinia (ESM/TypeScript). Agent compute nodes: Java 17 + Maven.

## How to investigate

Read highest-value sources first: `README*`, root manifests, workspace config, lockfiles, build/test/lint/typecheck/codegen config, CI workflows, existing instruction files (`ai/CODING.md`). Prefer executable sources (package.json scripts, jest/vitest configs, CI) over prose. If docs conflict with config, trust the config.

## Quick Start

```bash
cp .env.example .env.local   # root env is gitignored; never commit secrets
docker compose --env-file .env.local up --build                        # dev: frontend :3000, API :3001, PG :5432
docker compose --env-file .env.local -f docker-compose.yml up --build  # prod-style: frontend :3002, API :3001

# Fresh checkout: install Node 24 (via nvm), deps and the Cypress binary
bash scripts/bootstrap-local.sh
# Local PR checks (not Docker integration, Cypress, agent image or sandbox)
bash scripts/verify-local.sh

# Manual dev (requires Node 24 LTS):
nvm use 24                          # or use `.nvmrc`
cd backend && npm run dev          # API :3001, uses `node --watch`
cd ../frontend && npm run dev      # Vite :3000, proxies /api → :3001
```

`.env.local` (root, copied from `.env.example`) requires: `POSTGRES_PASSWORD`, `JWT_SECRET`, `PGADMIN_PASSWORD`, `ENCRYPTION_KEY`. `.env` and `.env.local` are gitignored.

## Structure

```
backend/src/
  index.js          → exports app (NODE_ENV=test skips listen; supertest uses app directly)
  api/routes.js     → /health, /version, /docs, /metrics, /auth/*, /v1/*
  api/v1/index.js   → 25 route modules via 29 router.use mounts (users, projects, tickets, agent-nodes, provider-registry, approvals, harness, ...) + inlined template/attachment/planning/ip-whitelist routes
  services/         → 48 services
  controllers/      → 12 controllers
  models/           → approval, project, ticket, user
  migrations/       → 60 registered .sql files + 1 data migration; apply.js runs in array order (not numeric) and records schema_migrations
  middleware/       → 18 files (auth, permissions, validate (Joi), cors, rate limiter, CSP, requestId, error handler, timeout, apiVersion, multer)
  validators/       → 19 Joi schemas
  db.js             → pg Pool (DATABASE_URL env)

frontend/src/
  stores/               → auth.ts (singleton Pinia store; tokens/permissions in localStorage) + rateLimit.ts
  api/client.ts         → native `fetch` (NOT axios, despite axios being a dep)
  api/generated/        → TS types via openapi-typescript-codegen
  router/index.ts       → reads vibecode_token directly from localStorage

agent/                  → Java 17 Maven, shaded JAR; `harness/` = OpenCode supervisor (fg-30)
ai/CODING.md            → coding principles
architecture/           → system-design.md
planning/               → 00-04 templates + bp-XX/, bt-XX/, fg-XX/ suites
```

## Commands

### Backend (from `backend/`)
```bash
npm run dev          # node --watch src/index.js → :3001
npm start            # production start (no watch)
npm test             # Jest unit tests (jest --passWithNoTests)
npm run test:coverage # Jest with coverage (60% threshold)
npm run test:integration # Real PG integration tests (jest.integration.config.js)
npm run lint         # ESLint flat config (eslint.config.js)
npm run db:migrate   # node src/migrations/apply.js
npm run db:reset     # same as migrate
npm run generate:spec # Generate openapi-generated.json from JSDoc
```

### Frontend (from `frontend/`)
```bash
npm run dev          # Vite :3000, proxies /api → :3001
npm run build        # vite build
npm run preview      # preview prod build
npm run lint         # ESLint flat config (eslint.config.js)
npm test             # Vitest in **watch mode**; use `npm test -- --run` for CI
npm run typecheck    # vue-tsc --noEmit (strict + noUnusedLocals + noUnusedParameters)
npm run generate:api # openapi-typescript-codegen from backend openapi-generated.json
npm run cypress:e2e  # cypress run --e2e --browser chrome --headless
npm run cypress:component # cypress run --component --browser chrome
```

### Docker
```bash
docker compose --env-file .env.local up --build          # dev mode (override: frontend :3000, API :3001, PG :5432)
docker compose --env-file .env.local -f docker-compose.yml up --build  # production ports (frontend :3002)
docker compose --env-file .env.local --profile dev up    # includes pgadmin on :5050
docker compose --env-file .env.local down -v             # stop and remove volumes
```

## Testing

### Backend (Jest)
- Test files: `src/__tests__/*.test.js` + `src/__tests__/unit.test.js` + `src/middleware/*.test.js`. Default config ignores `integration/` and `docker/` paths.
- `setupFilesAfterEnv`: `src/__tests__/jest.setup.js` — mocks pg, winston, bcryptjs, uuid, jsonwebtoken, and provides a full Redis mock with rate-limit simulation. No real DB needed.
- `moduleDirectories: ['node_modules', '<rootDir>']` + `moduleNameMapper` for `models/`, `services/` — `require('services/Foo')` works.
- `maxWorkers: 1`, `testTimeout: 10000`, `forceExit: true`, `restoreMocks: true`.
- Integration tests: `jest.integration.config.js` — real PG, `maxWorkers:1`, `testTimeout:30000`, `restoreMocks: false`, `forceExit: true`. Test paths: `**/integration/**/*.test.js` + `**/docker.test.js`.
- Bash integration suite: `backend/integration-test/run.sh` — curl against Docker containers + real PG. Sets `INTEGRATION_TESTS=1` to disable rate limiting. Run with `bash backend/integration-test/run.sh --only` (assumes services running).
- **File upload tests** (`file_upload.test.sh`) are skipped in CI (`CI=1` env var). Run locally with `CI=` (unset).

### Frontend (Vitest + Cypress)
- 66 unit test files / 574 tests in `src/__tests__/`. `setupFiles: src/__tests__/setup.ts` loads design-tokens.css variables into DOM for tests.
- 7 Cypress e2e specs + 7 component specs in `cypress/`. Seed data is created through `cy.seed()` in `cypress/support/commands.ts`.
- Contract test: `src/__tests__/api-contract.test.ts` — verified in CI.
- Coverage excludes many views/components intentionally listed in `vitest.config.ts`.

### CI (Jenkins — `Jenkinsfile`)
These commands run inside Jenkins, which writes the root `.env` before Compose.
Local commands above use `--env-file .env.local` instead.
```
checks (parallel):
  backend:       npm ci → lint → syntax check → helper unit tests → coverage (runs the unit tests)
  frontend:      npm ci → lint → typecheck → coverage (runs the unit tests) → build
  contract test: vitest run api-contract.test.ts (reuses the frontend node_modules)
  agent:         mvn package (runs the tests) → agent image build
cypress: Jenkins writes .env → docker compose (e2e overlay) → cypress/included runs e2e + component
integration job: Jenkins writes .env → docker compose up → Jest integration tests → bash integration tests
fleet clean cut: fresh vibecode_fg54_cut DB → fleet-clean-cut.sh (REQUIRE_FLEET_SCHEMA=1)
sandbox job: build sandbox/proxy images → Docker integration suite
cleanup job: Jenkinsfile.cleanup → label/age-scoped orphan GC (dedicated host)
```
The full pipeline runs on every build; no stages are skipped by change detection. Backend CI uses a real PostgreSQL service container. Integration tests run in a dedicated `docker-compose.test.yml` test container. When Jenkins runs in a container, `agent/scripts/sandbox-ci-env.sh` maps its workspace to the Docker host path; set `JENKINS_HOST_HOME` if the mount cannot be discovered automatically (identity fallback warns). `JENKINS_HOST_HOME` only maps a workspace under `JENKINS_HOME`; a workspace outside that root is left unchanged.

BP-135 cleanup is scoped: the pipeline tears down its own Compose project before `cleanWs()` and removes only its job/build image tag; Compose project names include the branch, job and build, and post cleanup requires `CI_JOB` plus the build ID because build numbers are unique only within a job. `Jenkinsfile.cleanup` runs on the dedicated `vibecode-ci-docker` node, is job-agnostic, and removes only positively labelled, age-scoped resources. Never add a broad `docker system prune`, a name-prefix-only selector, or removal of `vibecoder-ai-planner`, the shared `postgres_data`/`uploads_data`/`vibecode_repos` volumes or the shared `:ci` aliases. Retention is `CI_IMAGE_GRACE_HOURS` (24), `CI_CONTAINER_GRACE_HOURS` (2) and `CI_BUILD_GRACE_HOURS` (6); see the bp-135 runbook.

### Bug fix protocol
Every fix **must** include a regression test.
- **Route bugs**: `supertest` against Express app in `src/__tests__/routeOrdering.test.js` or a new route test.
- **Service/controller bugs**: extend unit tests in `src/__tests__/` using existing jest mocks.
- **Frontend bugs**: extend Vitest unit tests in `frontend/src/__tests__/`.
- After fixing, run tests in order: the layer you changed, then the other layer, then integration tests.
- For backend changes: `npm test` → `npm test -- --run` (frontend) → `npm run test:integration` → `bash backend/integration-test/run.sh`.
- For frontend changes: `npm test -- --run` → `npm test` (backend) → `npm run test:integration` → `bash backend/integration-test/run.sh`.

### Coverage threshold (60%)
Both backend and frontend enforce a **60% minimum coverage** (lines, functions, branches, statements) in CI.
- Backend: `npm run test:coverage` — Jest with built-in Istanbul
- Frontend: `npm test -- --run --coverage` — Vitest with `@vitest/coverage-v8`
- CI will fail if coverage drops below 60%. Run coverage locally before pushing.

### Test-first requirement
When a `04_SPECIFICATION.md` is created for a ticket, it includes a **Test-First Requirement** section. The implementing agent MUST:
1. Create empty test stub files (with imports, `describe` blocks, stub `it` blocks) **before** any production code
2. Create production code files
3. Fill in test stubs with actual assertions

This prevents agents from skipping tests. The test stubs are listed as the first file operations in `04_SPECIFICATION.md`.

## Agent harness (fg-30)

The Java agent runs the OpenCode harness: the supervisor starts `opencode serve`
in an isolated temp HOME and cloned workspace, sends a prompt, then verifies,
commits, pushes and opens the PR. Commit/push/merge are denied by policy (config + denied bash rules), but
  that is defense-in-depth, not a hard security boundary: the workspace is
  hostile. The supervisor owns publishing, runs git with hooks/fsmonitor
  disabled, restores a trusted `.git/config`, sanitizes child environments,
  disables OpenCode project config, and refuses protected paths
  (`.env*`/`**/.env*`, `Jenkinsfile`, `.github/**`, `**/secrets/**`) or
  oversized diffs.

Harness env: `HARNESS_BIN`, `HARNESS_STARTUP_TIMEOUT_MS`,
`HARNESS_MAX_DURATION_MINUTES`,
`HARNESS_VERIFY_COMMANDS` (semicolon-separated; empty = autodetect, then fail
closed), `HARNESS_PROTECTED_PATHS`, `HARNESS_MODEL`, `HARNESS_MAX_FILES`,
`HARNESS_MAX_LINES`, `HARNESS_MAX_BYTES`, `HARNESS_FSCK`,
`HARNESS_RETRY_PIN_ATTEMPTS`,
`HARNESS_RETRY_BASE_DELAY_MS`, `HARNESS_RETRY_MAX_DELAY_MS`,
`HARNESS_LEASE_SECONDS`, `HARNESS_HEARTBEAT_SECONDS`,
`HARNESS_DURABILITY_REQUIRED`, `HARNESS_RESUME_MODE`,
`HARNESS_REAPER_INTERVAL_SECONDS`, `HARNESS_WORKSPACE_RETENTION_HOURS`.
Host sizing (fg-43): `AGENT_HOST_MAX_RUNTIMES` (default 50),
`SUPERVISOR_CPUS`, `SUPERVISOR_MEMORY_LIMIT`,
`SUPERVISOR_MEMORY_BUDGET_MB`; `agent/scripts/host-init.sh` writes
`.env.agent-host` and Compose applies the limits.
Supervisor health gate (fg-56): `SUPERVISOR_HEALTH_REQUIRED` (default true),
`SUPERVISOR_HEALTH_TIMEOUT_SECONDS` (120), `SUPERVISOR_HEALTH_INTERVAL_SECONDS`
(2) — the supervisor waits for `BACKEND_URL/api/health` before enrollment,
declaration or child spawn. Post-start monitor: `SUPERVISOR_HEALTH_MONITOR_ENABLED`
(default true; off when the gate is off), `SUPERVISOR_HEALTH_MONITOR_INTERVAL_SECONDS`
(10) and `SUPERVISOR_HEALTH_MONITOR_MAX_BACKOFF_SECONDS` (60); declaration/reconcile
pauses while the backend is unhealthy.
Question loop (fg-55): `HARNESS_QUESTION_LOOP` (default off),
`HARNESS_QUESTION_TIMEOUT_MINUTES`, `HARNESS_QUESTION_POLL_SECONDS`,
`HARNESS_DOOM_LOOP_MAX`, `HARNESS_DOOM_LOOP_CONTINUES`.
Storage lifecycle (fg-44/fg-58): `AGENT_IDLE_REFRESH_MS` (2h),
`AGENT_MAX_LIFETIME_HOURS` (24), `AGENT_DISK_BUDGET_GB`,
`HARNESS_WORKSPACE_RETENTION_HOURS` (24), `AGENT_STORAGE_CHECK_SECONDS` (60),
`AGENT_STORAGE_METER_SECONDS` (300),
`AGENT_STORAGE_WARN_PCT`/`STOP_PCT`/`CLEAN_PCT`/`RECYCLE_PCT`/`MANUAL_PCT`
(70/80/85/90/95), `AGENT_ORPHAN_TTL_HOURS` (24). The supervisor refreshes idle
runtimes, samples disk plus inodes, sweeps runtime/legacy/temp roots into
`/repos/orphans/`, prunes dangling images weekly and emits `storage.*` events;
`agent/scripts/host-storage.sh` is the stopped-supervisor recovery path and
treats stale PID/`.active` state as recoverable.
Budgets/routing (fg-38): `HARNESS_DEFAULT_MAX_DURATION_MINUTES`,
`HARNESS_DEFAULT_MAX_INPUT_TOKENS`, `HARNESS_DEFAULT_MAX_OUTPUT_TOKENS`,
`HARNESS_DEFAULT_MAX_COST_USD`, `HARNESS_DEFAULT_MAX_TOOL_CALLS`,
`HARNESS_DEFAULT_MAX_RETRIES`, `HARNESS_DEFAULT_DAILY_COST_USD`,
`HARNESS_DEFAULT_PROJECT_MAX_CONCURRENT_RUNS`,
`HARNESS_DEFAULT_AGENT_MAX_CONCURRENT_RUNS`, `HARNESS_DEFAULT_WARN_RATIO`,
`HARNESS_DEFAULT_ROUTING_POLICY`, `HARNESS_FREE_MODEL`, `HARNESS_PAID_MODEL`,
`HARNESS_COMPLEXITY_THRESHOLD`. Observability (fg-41):
`HARNESS_EVENT_MAX_STRING`, `HARNESS_STUCK_MINUTES`,
`HARNESS_DIFF_ALERT_BYTES`, `HARNESS_REPEATED_FAILURES`,
`HARNESS_FAILURE_RATE_WINDOW_MINUTES`, `HARNESS_EVENT_RETENTION_DAYS` (30),
`HARNESS_AUDIT_RETENTION_DAYS` (365). Privacy defaults (fg-42):
`HARNESS_DEFAULT_MAX_DATA_CLASS`, `HARNESS_DEFAULT_ALLOWED_PROVIDERS`,
`HARNESS_DEFAULT_REQUIRE_NO_TRAINING`, `HARNESS_NO_TRAINING_PROVIDERS`,
`HARNESS_DEFAULT_LOCAL_ONLY`, `HARNESS_DEFAULT_LOCAL_ENDPOINT`,
`HARNESS_DEFAULT_LOCAL_MODEL`, `HARNESS_DEFAULT_DATA_RESIDENCY`,
`HARNESS_DEFAULT_BLOCK_ON_SECRET`, `HARNESS_DEFAULT_BLOCK_ON_PII`,
`HARNESS_DEFAULT_REDACT_PII`, `HARNESS_DEFAULT_EVENT_RETENTION_DAYS`,
`HARNESS_DEFAULT_ARTIFACT_RETENTION_DAYS`; the agent reports its provider
region from `AI_REGION`. `HARNESS_PRIVACY_REQUIRE_DURABILITY` (default true)
refuses a run when the backend privacy policy cannot be resolved. A breach
stops the session with run
status `budget_exceeded`, never publishes, and releases the ticket; the global
or project kill switch blocks new runs and withdraws leases from active ones.
`harness_events` is append-only; only the retention purge may delete rows.
Sandbox: `SANDBOX_MODE` (`host` legacy, `docker` sandboxes install/verification
and model-driven shell commands), `SANDBOX_IMAGE`, `SANDBOX_PROXY_IMAGE`,
`SANDBOX_REQUIRE`, `SANDBOX_CPUS`,
`SANDBOX_MEMORY_MB`, `SANDBOX_PIDS`,
`SANDBOX_DISK_MB`/`SANDBOX_DISK_CHECK_INTERVAL_SECONDS`/`SANDBOX_DISK_ENFORCE`,
`SANDBOX_NOFILE`, `SANDBOX_TMPFS_MB`,
`SANDBOX_NETWORK` (`none` or `allowlist`), `SANDBOX_ALLOWED_HOSTS`,
`SANDBOX_EGRESS_UPSTREAM_NETWORK`, `SANDBOX_EGRESS_PROBE_TIMEOUT_MS`,
`SANDBOX_EGRESS_TLS_MODE` (`sni-only` default; `terminate` opts into D16 TLS termination),
`SANDBOX_EGRESS_ORIGIN_CA_HOSTS`/`SANDBOX_EGRESS_ORIGIN_CA_B64` (opt-in,
per-host origin CA bundle for `terminate` mode),
`SANDBOX_EGRESS_PROXY` (reserved; rejected),
`SANDBOX_ENV`, `SANDBOX_USER`, `SANDBOX_ALLOW_ROOT`,
`SANDBOX_EXEC_TIMEOUT_SECONDS`, `SANDBOX_ARTIFACT_MAX_BYTES`,
`SANDBOX_SECCOMP_PROFILE`, `SANDBOX_APPARMOR_PROFILE`,
`SANDBOX_CONTAINER_WORKSPACE_ROOT`, `SANDBOX_HOST_WORKSPACE_ROOT`,
`SANDBOX_REQUIRE_SECURE_FILE_ACCESS`, `SANDBOX_CONTROL_NETWORK`,
`SANDBOX_OWNER`, `SANDBOX_POOL_AGENT`, `SANDBOX_DAEMON_ID`.
Docker mode needs a daemon connection and a host-visible workspace. PoolManager
forwards the operator `SANDBOX_*` settings to pool agents, sets `DOCKER_HOST`
only when Docker mode is enabled, resolves the repo volume mountpoint as
`SANDBOX_HOST_WORKSPACE_ROOT`, and attaches Docker-mode agents to an internal
control network shared only with the restricted socket proxy. Host-mode agents
receive neither `DOCKER_HOST` nor that network, so repo code cannot reach the
proxy. `AGENT_DOCKER_HOST` overrides the proxy address; if only the API's unix
socket is configured, Docker mode fails closed and requires an explicit proxy.
Pool agents receive `BACKEND_URL=http://api:3001` by default; the root Compose
API sets it explicitly. In Compose, `REPO_VOLUME` names the repo volume and
keeps the API mount and PoolManager bind aligned; use the non-Compose runner
for a host-path workspace. `SANDBOX_REQUIRE=true` is rejected by the API unless
`SANDBOX_MODE=docker`, before any DB agent or container is created, and a
failed create/attach removes the container and DB agent record.

Pool Docker reaping reserves `SANDBOX_OWNER=pool-*` for PoolManager. A managed
agent also receives `SANDBOX_POOL_AGENT=true` and `SANDBOX_DAEMON_ID` (the API
daemon ID) and labels its own container `vibecode.agent.owner=<owner>`. A pool
agent sweeps another `pool-` owner's managed resources only when no agent
container carries that label and both Docker clients report the same daemon;
a daemon mismatch or unknown ID skips the sweep safely. Custom Docker socket
proxies must also enable `INFO=1` (the root Compose proxy does). `pool-` owners
and `SANDBOX_POOL_AGENT=true` are PoolManager-only; a manual agent must use a
numeric/non-pool owner. A manual agent that opts in without the matching agent
container label is unsupported and can still be treated as stale. Numeric-owner
resources from #154–#157 and pre-#154 unlabeled resources need a one-time
operator cleanup. A stopped agent container counts as live, so its owner's
resources wait until the container is removed.

The standalone agent Compose file keeps host mode on the API network only. Set
`ROOT_COMPOSE_PROJECT` (or `VIBECODE_NETWORK`/`SANDBOX_CONTROL_NETWORK`) to the
root project's actual networks. Docker mode also uses
`-f agent/docker-compose.sandbox.yml`, which adds the restricted proxy network
and sets `DOCKER_HOST`; host mode never joins that network. The run also needs
a host bind at `/repos` (`REPO_HOST_PATH`) writable by the agent user (uid 100,
gid 101) and `SANDBOX_HOST_WORKSPACE_ROOT` set to the same absolute host path. OpenCode still runs in the
supervisor, but the built-in `bash`/`shell` tool is disabled and the
`sandbox_bash` tool forwards commands to the sandbox bridge. The sandbox has
no direct egress or external DNS; `SANDBOX_NETWORK=allowlist` routes traffic
through a hardened proxy attached to an internal Docker network that validates
the first CONNECT ClientHello SNI and rejects multiple SNI names/extra
handshakes and CONNECT :80. TLS renegotiation and the encrypted inner Host are
D16. In `terminate` mode, `SANDBOX_EGRESS_ORIGIN_CA_HOSTS` plus a
base64-encoded PEM bundle in `SANDBOX_EGRESS_ORIGIN_CA_B64` add an opt-in
origin CA for exact allowlisted hosts (private registries/pinned CAs, D27).
The bundle must contain public certificate material only, never a private key,
is scoped to those hosts, and does not relax `Host == SNI` or any other D16
check. The supervisor logs the trusted hosts and a SHA-256 fingerprint and
surfaces the proxy's configured/used audit lines when the sandbox is destroyed;
"used" is recorded only after an origin response. D14 (the freeze-and-verify
descendant sweep) is merged (#139), so Docker mode can be used for untrusted
repositories with that gate in place; do not treat the allowlist as a hard host
boundary until D16 is closed (`sni-only` remains the default, `terminate` is
opt-in).
Verification and harness children receive proxy/registry variables only after
URL userinfo is stripped, and `MAVEN_OPTS` is not inherited. Authenticated
enterprise proxies and private npm registries must be configured at the
network/container layer, not through supervisor credentials: prefer a pull-only
registry proxy for untrusted sandboxes, and make any mounted `.npmrc`
read-only/pull-only.
The prompt labels ticket/planning/repository content as untrusted and states
that supervisor rules win; the built-in `read`/`grep`/`lsp` tools are disabled,
`sandbox_read`/`sandbox_grep` resolve `toRealPath()` and reject any target
outside the workspace or a credential path (grep never follows symlinks; D18
closed), the bridge denies a high-confidence subset of credential-read and
network-upload commands, and the supervisor refuses to publish a guarded-tree
blob whose content or new path contains a configured credential or a
high-confidence credential format (matches already present in the base blob are
ignored, so pre-existing fixtures do not block unrelated edits; complete PEM,
PGP and SSH2 private-key blocks are compared as a whole with case-insensitive
BEGIN/END markers, and AWS temporary keys and Slack xoxc/xoxd tokens are
covered). Prompt injection remains probabilistic; the sandbox and publishing
guard are the boundary. Verification output (including its exception messages)
is redacted for configured secrets and high-confidence credential formats before
branch names, ticket messages, run errors and commit/PR titles and bodies are
stored (NFR5); a credential-keyword lookahead keeps nested assignments inside
non-credential values visible. Legacy processors and externally shipped logs are
D19.
Sandbox base images are digest-pinned; `agent/scripts/sandbox-image-security.sh
--check-pins` enforces that (case-insensitive `FROM`, BOM tolerant, digest on
the image token), and the same script generates an SBOM (syft), scans for
vulnerabilities (trivy/grype) and optionally verifies a cosign signature. CI
scans the supervisor, sandbox and proxy images and archives the SBOMs; set
`SANDBOX_SCAN_REQUIRED=1` in CI to make the scan mandatory.
Phase 1 is blocking
prompt mode and denies the `doom_loop` tool. The fg-55 human loop is opt-in via
`HARNESS_QUESTION_LOOP=true` (default off): it allows `question`, persists a
ticket question, pauses the wall-clock budget, polls for a member answer and
resumes the same OpenCode session. A timeout fails the run with
`question_timeout`. `doom_loop` stays denied; the supervisor escalates repeated
tool signatures to a `doom_loop` question and aborts at the continue cap. With
the flag off the Phase 1 behavior is unchanged.
See `planning/fg-30-autonomous-coding-harness/` and
`planning/DONE/fg-55-human-question-loop/`.

## API

All responses: `{ success: boolean, data: ..., requestId?: string }` or `{ success: false, error: { code, message } }` (auth endpoints may diverge).

- `/api/auth/me` returns `user.id` (DB row ID), **not** JWT `userId`.
- `/api/auth/register` rate-limited (3/60s), default role `project_admin`. Login: 5/60s, lockout after 10 failures (15 min). `/auth/me`: 30/60s.
- `/api/docs` — Swagger UI; `/api/openapi.json` — raw spec (generated from JSDoc via swagger-jsdoc).
- Agents auth via `X-API-Key` header. Mock keys: starts with `test-` or equals `mock-agent-key`.
- `TICKET_DELETE` enforced in `TicketService.delete()` (not middleware) — `user` role can delete own tickets only.
- 30 permissions, 4 roles: `user`(9), `member`(14), `project_admin`(26), `super_admin`(30).

**Ticket status transitions**: `backlog→in_progress`, `in_progress→review|backlog`, `review→done|backlog`. `done` has no outgoing transitions.

**Readiness gate (fg-45)**: `READINESS_GATE_MODE=off|warn|enforce`
(default `warn`) controls the Definition-of-Ready assertion on pickup,
`POST /status`, `PUT /tickets/:id` (status changes into `in_progress`) and phase
transitions whose target maps to `in_progress`. `warn` audits and allows;
`enforce` returns 409 `READINESS_FAILED` with `details.issues` and filters unready
tickets out of the agent backlog. `READINESS_SWEEP_INTERVAL_MINUTES` (default
60, `0` disables) expires readiness waivers. Existing `in_progress`/`review`/
`done` tickets are grandfathered; `POST /tickets/:id/readiness/replan` clears
the exemption.

**Harness observability/budgets**: agent writes go to `POST /harness/events` and
`POST /harness/runs/:runId/usage`; operators use
`GET /harness/runs/:runId/events|timeline|usage`,
`GET /harness/projects/:projectId/runs|events|audit|dashboard|usage`,
`GET|PUT /harness/projects/:projectId/budget-policy|kill-switch`,
`GET /harness/projects/:projectId/kill-switch/audit` and
`GET|PUT /harness/kill-switch` (global, super_admin). Agent events are run-scoped
and cannot write `audit.*`.

**Migrations**: run by `src/migrations/apply.js` in **array order** (not numeric). 60 registered SQL files + 1 data migration (`migrate_provider_api_keys.js`); applied files are recorded in the `schema_migrations` ledger. A ledger-less post-cut database is baselined only through 059, so newer additive migrations (060+) still run. Notable entries: 057 (the agent-fleet clean cut) is registered after 059 despite its number; 011/012 after 014; 020 after 018 (no 019); 031 has two registered files. `029_data_migrate_provider_api_keys.sql` (and its rollback) is on disk but **not** in the apply array; the registered file is `029_provider_config_api_key.sql`. Each registered SQL has a `_rollback.sql` counterpart.

**Frontend auth**: 3 localStorage keys — `vibecode_token`, `vibecode_user`, `vibecode_permissions`. Route guards read localStorage directly (no Pinia dependency).

**WebSocket terminal proxy**: `/api/terminal/` — super_admin only, token via URL param.

## Planning

When making architectural changes, read `planning/README.md` first, then the
suite's documents in order: `00_ARCHITECT_CHECKLIST.md`,
`01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`,
`03_ARCHITECT_IMPLEMENTATION.md`, and optionally `04_SPECIFICATION.md` /
`05_RUNBOOK.md`. Repo-wide rules live in `planning/ENGINEERING_STANDARDS.md`.

**Check existing infrastructure first** — if backend API exists, work frontend-only. If frontend exists, work backend-first. Both exist → extend. Neither → plan both.

Create new planning suites in `planning/bp-XX-name/` for multi-file changes requiring architectural decisions.

**Pending tickets**: See `PENDING.txt` for all unimplemented planning suites. Completed suites are in `planning/DONE/`.

**Single-source rule**: each fact has one owner. Status lives only in `00`
frontmatter; deferred scope lives only in `00`'s Deferred register;
requirements are numbered `FR*`/`NFR*` in `01`; the requirement-to-test matrix
lives only in `03`. Other documents link to the owner instead of copying the
table. Do not add a "Pending Scope" section to `02`, `03` or `04`. Run
`node planning/check-planning.js` before opening a planning PR.

**Review policy**: the reviewer must be a separate session/agent from the
author and read-only; findings need file:line/command evidence; only blocking
findings gate; the fix loop is bounded. See `planning/README.md` §Review policy.
The second independent reviewer pass (`fg-47`) is planned, not part of the
current flow; `fg-48` plans the deterministic `check-claims` script.

**Formal pre-merge steps**: before implementation, `01` carries an assumptions
table and change impact, and `02` carries failure modes and security
considerations for non-small tickets (`fg-45`). Before `human_approval` and
merge, every `FR*`/`NFR*` maps to code, a test and passing verification evidence
at the reviewed SHA (`fg-51`). Both are readiness/review gates inside the
existing phases, not new phases; their automated enforcement is planned.

**Status/claim rule**: `done` means the implementation merged, with a PR and a
dated `03` Results row. A merged planning PR is `plan merged`, not `done`.
`PENDING.txt` and `HARNESS_ROADMAP.md` labels must match `00` (`Plan merged` vs
`Merged`). Do not claim "implementation merged" in a `planned` suite.

## Coding methodology

Plan before making non-trivial changes, make the smallest coherent change, and add or update tests for the behavior you change. Run the project's verification commands before finishing. Record assumptions and non-obvious trade-offs in the ticket or PR.

## Deferred Improvements (Goldmine)

Every planning ticket keeps a **Deferred register** in
`00_ARCHITECT_CHECKLIST.md`. These are deferred improvements — small,
high-value changes that were intentionally left for later. **Before starting
any ticket, read the deferred registers** of previously committed tickets (in
`planning/DONE/` and `planning/archived/`). Common goldmine categories:

- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator, CI integration
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

When you create a new ticket, record relevant follow-ups in its own deferred
register — do not copy the whole backlog into every document.

Unplanned defects and flow changes found while testing live in `FUTURE_IDEAS.txt`
under the **Ticket lifecycle, phase flow & defects (intake)** section. Promote an
item into a planning suite (or attach it to the owning suite) before implementing
it, then remove/update the intake row instead of duplicating it. Quality-gate and
Definition-of-Ready enforcement is scoped to `planning/DONE/fg-45-ticket-quality-gates/`.

## Gotchas

- Backend ESLint uses **flat config** (`eslint.config.js`), not `.eslintrc*`.
- Frontend ESLint uses flat config with TypeScript + Vue plugins; Vue components require `PascalCase` names, `camelCase` props, and `require-default-prop`.
- Frontend `api/client.ts` uses native `fetch` — **not axios** (axios is a dep but unused for API calls).
- Docker compose has two modes: `docker compose --env-file .env.local up` uses `docker-compose.override.yml` (dev ports 3000/3001); `docker compose --env-file .env.local -f docker-compose.yml up` uses production ports (frontend 3002). Always pass `--env-file .env.local`; `.env` is not tracked.
- Backend `npm run dev` uses `node --watch` (Node 24 LTS required).
- Frontend `npm test` runs Vitest in watch mode; CI uses `npm test -- --run`.
- npm 11 blocks dependency install scripts by default, so `npm ci` does not download the Cypress binary; `scripts/bootstrap-local.sh` runs `npx cypress install` explicitly.
- Jest mocks pg, winston, bcryptjs, uuid, jsonwebtoken, **and provides a full Redis mock** — no real DB needed.
- Integration tests (`npm run test:integration`) use a real PG at `postgresql://postgres:changeme@localhost:5432/vibecode` with `maxWorkers:1`.
- Migration order in `apply.js` is **array order**, not numeric — 011/012 appear after 014.
- TypeScript strict mode: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` are all errors.
- GitHub publishing uses a repo-scoped App installation token by default (`GITHUB_AUTH_MODE=app`). The agent fetches it from `POST /api/v1/github/:projectId/token`, keeps it in memory and refreshes it before expiry; the token is never written to `.git/config`, argv, logs or the prompt. Projects map to installations via `project_github_installations`; `GITHUB_APP_INSTALLATION_ID` is a single-tenant fallback. `GITHUB_AUTH_MODE=pat` requires `ALLOW_PAT=true` on both the backend and agent and is for local development only. See `planning/DONE/fg-35-github-app-credentials/05_RUNBOOK.md`.
- `INTEGRATION_TESTS=1` env var disables rate limiting (used by bash integration suite).
- Frontend `vitest.config.ts` has a long exclude list of intentionally untested views/components — don't be surprised by low coverage there.
- `docker-compose.override.yml` sets `NODE_ENV=development`, `ALLOW_PRIVATE_HOSTS=1`, and mounts `/var/run/docker.sock` for local dev.
