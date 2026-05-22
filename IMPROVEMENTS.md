# Project Improvement Tickets

Generated from comprehensive audit of backend, frontend, and infrastructure.
Organized by severity. Each ticket is actionable and references specific files/lines.

---

## P0 - CRITICAL (breaks functionality or build)

### TKT-100: Routes defined in routes.js are never mounted
- **File**: `backend/src/index.js`
- **Problem**: `src/api/routes.js` defines all API routers (auth, projects, tickets, pricing, agents) and exports them, but `index.js` never imports or mounts this router. The health and version endpoints are the only ones that work.
- **Impact**: All API endpoints are unreachable — the entire app is broken.
- **Fix**: Add to `index.js`:
  ```js
  const routes = require('./api/routes');
  app.use('/api', routes);
  ```

### TKT-101: Auth store has no reactivity — login/logout state changes never propagate
- **File**: `frontend/src/stores/auth.js`
- **Problem**: `user` and `token` are plain values read once from localStorage. They are not wrapped in `ref()` or `reactive()`. Vue components get stale copies.
- **Impact**: Pinia is initialized in `main.ts` but the store is never actually reactive. Login state never propagates to any component.
- **Fix**: Rewrite as a proper Pinia store with `defineStore()`, using `ref()` for state and `localStorage` for persistence.

### TKT-102: Login and Register forms are dead code — zero API calls
- **Files**: `frontend/src/views/Login.vue` (lines 13-18), `frontend/src/views/Register.vue` (lines 13-20)
- **Problem**: Both forms only `console.log()` on submit. No API calls, no validation, no error states, no loading states.
- **Impact**: Users can fill out the entire auth flow and nothing happens.
- **Fix**: Wire both forms to `POST /api/auth/register` and `POST /api/auth/login` using the auth store.

### TKT-103: Router imports non-existent module — breaks frontend build
- **File**: `frontend/src/router/index.ts` (line 2)
- **Problem**: `import { definePage } from '../composables/usePage'` — no `composables/` directory exists. The import will crash the build.
- **Impact**: Frontend fails to build/compile.
- **Fix**: Remove the unused import.

### TKT-104: TicketBoard.vue calls undefined `columnTickets()` function
- **File**: `frontend/src/views/TicketBoard.vue` (lines 162, 167)
- **Problem**: Template calls `columnTickets(columnDef.id)` which is never defined. Computed properties (`backlogTickets`, etc.) exist but are never used in the template.
- **Impact**: Runtime `ReferenceError` — the Kanban board crashes.
- **Fix**: Define `columnTickets(status)` as a function that filters `tickets.value` by status, or use the existing computed properties in the template.

### TKT-105: TicketDetail.vue calls async functions in template — renders `[object Promise]`
- **File**: `frontend/src/views/TicketDetail.vue` (lines 111, 123)
- **Problem**: `updateProjectName()` and `updateAssignee()` are async functions called directly in the template. Vue cannot handle async in templates.
- **Impact**: Displays `[object Promise]` or blank. Also triggers redundant async calls on every render.
- **Fix**: Make them synchronous getters or use computed properties.

### TKT-106: AIAssistant.vue references undefined `event` in `insertText()`
- **File**: `frontend/src/views/AIAssistant.vue` (line 218)
- **Problem**: `const textarea = event.target` — `event` is not a parameter or defined variable.
- **Impact**: `ReferenceError` on Tab key press in textarea.
- **Fix**: Add `event` as a parameter: `function insertText(text, event)`.

### TKT-107: TicketDetail.vue imports `deleteTicket` that doesn't exist in tickets.js
- **File**: `frontend/src/views/TicketDetail.vue` (line 13), `frontend/src/api/tickets.js`
- **Problem**: `deleteTicket` is imported but never exported from `tickets.js`.
- **Impact**: Runtime `ReferenceError` — the ticket detail page crashes.
- **Fix**: Either implement `deleteTicket` in `tickets.js` or remove the import.

---

## P1 - SECURITY (fix before any deployment)

### TKT-108: JWT secret fallback is hardcoded and guessable
- **Files**: `backend/src/auth.js` (line 4), `backend/src/middleware/auth.js` (line 4)
- **Problem**: Both files define `JWT_SECRET || 'super-secret-key-change-in-production'`. If env var is missing, anyone can forge JWT tokens.
- **Impact**: Complete auth bypass if `JWT_SECRET` is not set.
- **Fix**: Remove the fallback. Throw `Error('JWT_SECRET required')` at startup if missing.

### TKT-109: API keys are trivially predictable
- **File**: `backend/src/api/agents.js` (line 21)
- **Problem**: `apiKey = \`test-${name.toLowerCase().replace(/\s+/g, '-')}\`` — keys are deterministic from the agent name. No randomness.
- **Impact**: Anyone who knows an agent's name can guess its API key and gain full access.
- **Fix**: Use `crypto.randomUUID()` or `uuidv4()`. Store hashed in DB.

### TKT-110: API keys stored in plaintext in database
- **File**: `backend/src/services/AgentService.js` (line 87), `backend/src/migrations/002_agents_schema.sql` (line 7)
- **Problem**: `api_key TEXT UNIQUE` — raw keys in DB. If DB is compromised, all agent keys are exposed.
- **Impact**: Credential theft if database is accessed.
- **Fix**: Store `SHA-256(api_key)`. On lookup, hash the input and compare.

### TKT-111: `.env` file committed to repository with real secrets
- **File**: `backend/.env`
- **Problem**: Contains `JWT_SECRET` and `DATABASE_URL` with credentials. `.env.example` is identical.
- **Impact**: Secrets exposed in git history.
- **Fix**: Add `.env` to `.gitignore`. Make `.env.example` contain only placeholders like `JWT_SECRET=<your-secret>`.

### TKT-112: CORS origin hardcoded to dev IPs
- **File**: `backend/src/index.js` (lines 14-17)
- **Problem**: CORS allows `http://localhost:3000` and `http://192.168.3.33:3000`. These are development-only IPs.
- **Impact**: Will ship to production with dev-only CORS config.
- **Fix**: Make CORS origin configurable via `VITE_API_URL` or a dedicated env var.

### TKT-113: `agentAuthMiddleware` allows unauthenticated requests
- **File**: `backend/src/api/agents.js` (lines 93-96)
- **Problem**: When no `X-API-Key` header is provided, the middleware calls `next()` instead of returning 401. The `/tickets/create` endpoint later checks `req.headers.authorization` but `verifyToken` middleware was never applied, so `req.user` is undefined.
- **Impact**: Agent endpoints pass without any authentication validation.
- **Fix**: Return 401 when no valid auth is present, or chain `verifyToken` alongside the agent middleware.

### TKT-114: Hardcoded database credentials in docker-compose.yml
- **File**: `docker-compose.yml` (lines 12, 37)
- **Problem**: `POSTGRES_PASSWORD` defaults to `postgres`. Connection string embeds `postgres:postgres`.
- **Impact**: Anyone running docker-compose gets a database with a trivially guessable password.
- **Fix**: Remove the default: `${POSTGRES_PASSWORD}` (no fallback).

### TKT-115: `requireRole` imported but does not exist
- **File**: `backend/src/api/projects.js` (line 3)
- **Problem**: `const { requireRole, trackAgentAction, verifyToken } = require('../middleware/auth')` — `requireRole` is never defined in `auth.js`.
- **Impact**: `TypeError: requireRole is not a function` at runtime when projects router loads.
- **Fix**: Either implement `requireRole` middleware or remove the import.

---

## P2 - BROKEN (code that compiles but crashes at runtime)

### TKT-116: `authService.generateToken()` does not exist
- **File**: `backend/src/services/UserService.js` (line 32)
- **Problem**: Calls `authService.generateToken(user.id, email)` but `src/auth.js` has no `generateToken` method. `AuthService.register()` and `AuthService.login()` sign tokens internally.
- **Impact**: `TypeError` at runtime during authentication.
- **Fix**: Add `generateToken(userId, email)` to `AuthService`, or inline the token generation logic.

### TKT-117: `UserService.findById()` does not exist
- **File**: `backend/src/services/ProjectService.js` (lines 6, 19)
- **Problem**: Calls `UserService.findById(userId)` but `UserService` has no such method.
- **Impact**: `TypeError` when listing or creating projects.
- **Fix**: Add `findById` to `UserService`.

### TKT-118: `Ticket.updateStatus()` logic bug — always throws "Invalid status transition"
- **File**: `backend/src/models/ticket.js` (lines 105-114)
- **Problem**: `validTransitions[status].includes(id)` checks if the ticket `id` (a UUID string) is in the allowed transitions array. Since UUIDs are never in transition arrays, this always fails.
- **Impact**: Every status change throws an error — ticket workflow is broken.
- **Fix**: Fetch the current ticket status first, then check if the requested status is in the allowed transitions from the current status.

### TKT-119: `TicketService.claim()` and `TicketService.assign()` pass object instead of positional args
- **File**: `backend/src/services/TicketService.js` (lines 57, 65)
- **Problem**: `Ticket.update(ticketId, { assigneeId: userId }, userId)` passes an object as the `title` parameter. `Ticket.update()` expects positional args: `(id, title, description, status, priority, assigneeId, userId)`.
- **Impact**: Silent failure — ticket is not updated (COALESCE of an object is undefined).
- **Fix**: Call with positional args matching the method signature, or refactor `Ticket.update()` to accept an options object.

### TKT-120: `Ticket.update()` status validation checks wrong direction
- **File**: `backend/src/models/ticket.js` (lines 72-85)
- **Problem**: `validTransitions[status].includes(status)` — checks if the status is in its own allowed transitions. This would only pass if a status lists itself. Also allows `backlog -> done` directly, which violates the workflow.
- **Impact**: Wrong transitions allowed, correct transitions rejected.
- **Fix**: Validate against the ticket's *current* status, not the requested status.

### TKT-121: Three contradictory status transition definitions
- **Files**: `backend/src/models/ticket.js` (lines 74-78, 106-110), `backend/src/services/TicketService.js` (line 73)
- **Problem**: `Ticket.update()` allows `backlog -> done`, `Ticket.updateStatus()` only allows `backlog -> in_progress`, `TicketService.updateStatus()` only validates enum membership. None reference the ticket's current status.
- **Impact**: No reliable status transition enforcement.
- **Fix**: Unify to a single source of truth: `backlog -> in_progress -> review -> done`.

### TKT-122: `pricing.js` references undefined `sessionId` variable
- **File**: `backend/src/api/pricing.js` (line 61)
- **Problem**: `checkoutUrl: \`...\${sessionId}\`` — `sessionId` is not defined. The variable is `res.json({ sessionId: 'mock-session-id', ... })`.
- **Impact**: `ReferenceError` when accessing `/api/pricing/checkout`.
- **Fix**: Use `res.locals.sessionId` or the literal string `'mock-session-id'`.

### TKT-123: `pricing.js` references undefined `UserService`
- **File**: `backend/src/api/pricing.js` (line 72)
- **Problem**: `UserService.upgradeSubscription()` — `UserService` is never imported.
- **Impact**: `ReferenceError` when accessing `/api/pricing/upgrade/:userId`.
- **Fix**: Import `UserService` or implement the method.

### TKT-124: `AgentService.incrementDailyUsage()` references non-existent column
- **File**: `backend/src/services/AgentService.js` (lines 113-118)
- **Problem**: `UPDATE agents SET current_daily_usage = current_daily_usage + 1` — the `001_base_schema.sql` agents table has no `current_daily_usage` column. It exists in `002_agents_schema.sql` but not in the base schema.
- **Impact**: SQL error if `001_base_schema.sql` runs before `002_agents_schema.sql`.
- **Fix**: Add `current_daily_usage INTEGER DEFAULT 0` to the base agents table, or remove the `incrementDailyUsage` method (unused).

### TKT-125: `TicketService.getAgentTickets()` queries non-existent `project_agents` table
- **File**: `backend/src/services/TicketService.js` (lines 81-99), `backend/src/services/AgentService.js` (lines 94-111)
- **Problem**: Subquery references `project_agents` table which does not exist in any migration file.
- **Impact**: SQL error on any agent ticket query.
- **Fix**: Either create the `project_agents` table or rewrite the query to use `project_memberships`.

### TKT-126: Migration runner has hardcoded DB params alongside `connectionString`
- **File**: `backend/src/migrations/apply.js` (lines 12-18)
- **Problem**: Both `connectionString: process.env.DATABASE_URL` and individual `host`/`user`/`password`/`database` params are set. The pg library may ignore `connectionString` in favor of the individual params.
- **Impact**: Migrations may connect to the wrong database.
- **Fix**: Use only `connectionString`, or only individual params.

### TKT-127: Migration SQL splitting breaks on semicolons in string literals
- **File**: `backend/src/migrations/apply.js` (lines 24-25)
- **Problem**: `sql.split(';')` naively splits on all semicolons, including those inside SQL string literals.
- **Impact**: Migration fails on any SQL with semicolons in VALUES or WHERE clauses.
- **Fix**: Use a proper SQL parser, or wrap statements in `BEGIN; ... END;` transactions.

---

## P3 - BACKEND QUALITY

### TKT-128: Duplicate/conflicting migration files
- **Files**: `backend/src/migrations/001_create_tables.sql`, `001_base_schema.sql`, `002_agents_schema.sql`, `migrate.sql`
- **Problem**: Four migration files with conflicting schemas. `apply.js` only runs `001_base_schema.sql` and `002_agents_schema.sql`. The other two are dead code.
- **Impact**: Confusion about the authoritative schema. Duplicate `agents` table definitions.
- **Fix**: Keep only the files actually used by `apply.js`. Delete `001_create_tables.sql` and `migrate.sql`.

### TKT-129: `001_base_schema.sql` has `valid_priorities` constraint on wrong column
- **File**: `backend/src/migrations/001_create_tables.sql` (line 22) — note: this is a dead file but the bug exists here
- **Problem**: `CONSTRAINT valid_priorities CHECK (status IN ('backlog', 'low', 'medium', 'high', 'urgent'))` — the constraint is on `projects` table which has no `status` column. The values look like priorities not statuses.
- **Impact**: Would fail on table creation if this file were used.
- **Fix**: Remove from dead file, or fix and move to the active migration.

### TKT-130: `uuid_generate_v4()` requires extension not enabled by default
- **Files**: `backend/src/migrations/001_base_schema.sql` (line 6), `002_agents_schema.sql`
- **Problem**: Uses `DEFAULT uuid_generate_v4()` which requires `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`. Not available in PostgreSQL by default.
- **Impact**: Table creation fails on fresh databases.
- **Fix**: Use `DEFAULT gen_random_uuid()` (PostgreSQL 13+ native, already used in `001_create_tables.sql`).

### TKT-131: winston is a dependency but never used
- **File**: `backend/package.json`, `backend/src/index.js` (line 6)
- **Problem**: `winston` is in dependencies but `index.js` uses `console.info.bind(console)` as the logger. A mock exists at `__mocks__/winston.js` but is never imported.
- **Impact**: Dead dependency, added to Docker images unnecessarily.
- **Fix**: Either use winston throughout or remove from `package.json`.

### TKT-132: Multiple `dotenv.config()` calls
- **Files**: `backend/src/index.js` (line 1), `backend/src/db.js` (line 1), `backend/src/migrations/apply.js` (line 1)
- **Problem**: `.env` is loaded independently in three files. Path resolution depends on `process.cwd()` which varies.
- **Impact**: Unpredictable env var availability.
- **Fix**: Load dotenv exactly once in `index.js`.

### TKT-133: No database connection pool shutdown on exit
- **File**: `backend/src/db.js`, `backend/src/index.js` (lines 45-51)
- **Problem**: Shutdown handler closes the HTTP server but never calls `pool.end()`.
- **Impact**: Orphaned connections to PostgreSQL on graceful shutdown.
- **Fix**: Add `require('./db').pool.end()` to the shutdown handler.

### TKT-134: `/auth/me` has unnecessary try/catch
- **File**: `backend/src/api/routes.js` (lines 59-65)
- **Problem**: `verifyToken` middleware already catches invalid tokens and returns 401. The inner try/catch will never catch anything meaningful.
- **Fix**: Remove the try/catch.

### TKT-135: `pricing.js` imports `trackAgentAction` but never uses it
- **File**: `backend/src/api/pricing.js` (line 5)
- **Impact**: Dead import, confusing.
- **Fix**: Remove the import.

### TKT-136: `projects.js` imports `uuid.v4` but never calls it
- **File**: `backend/src/api/projects.js` (line 6)
- **Impact**: Dead import. UUIDs are generated by the database.
- **Fix**: Remove the import.

### TKT-137: Pricing and user stats endpoints return hardcoded mock data
- **File**: `backend/src/api/pricing.js` (all endpoints), `backend/src/api/user.js` (lines 36-49)
- **Problem**: `/pricing/user/:userId` returns hardcoded `pro` plan, `42 tickets`, `21.5` cost. `/user/stats` returns hardcoded `42 tickets`, `3 projects`, `156 apiCalls`.
- **Impact**: No real pricing functionality.
- **Fix**: Implement database-backed endpoints or clearly mark as stubs with TODO comments.

### TKT-138: Agent API key generation is not cryptographically secure
- **File**: `backend/src/api/agents.js` (line 21)
- **Problem**: Key is derived from agent name with no randomness. `test-<lowercase-name>` pattern is trivially guessable.
- **Fix**: Use `crypto.randomBytes(32).toString('hex')`.

---

## P4 - FRONTEND QUALITY

### TKT-139: 21 hardcoded `localhost:3001` URLs — `.env` variable never consumed
- **Files**: `frontend/src/api/agents.js` (9 occurrences), `frontend/src/api/tickets.js` (8), `frontend/src/api/projects.js` (2), `frontend/src/views/ProjectList.vue` (1), `frontend/src/views/TicketBoard.vue` (1)
- **Problem**: `.env` defines `VITE_API_URL=http://localhost:3001` but no file ever references `import.meta.env.VITE_API_URL`.
- **Impact**: Cannot change API URL without editing every file. Won't work in any environment other than dev.
- **Fix**: Create a centralized API client that uses `import.meta.env.VITE_API_URL`.

### TKT-140: Axios installed but never used
- **File**: `frontend/package.json` (line 17)
- **Problem**: `axios` is in dependencies but imported nowhere. All API calls use `fetch()`.
- **Impact**: Unnecessary 25KB+ bundle size.
- **Fix**: Either migrate to axios with interceptors or remove the dependency.

### TKT-141: `@heroicons/vue` and `vue-i18n` installed but never used
- **File**: `frontend/package.json` (lines 18-19)
- **Impact**: 35KB+ unnecessary bundle.
- **Fix**: Remove from dependencies or implement icon and i18n features.

### TKT-142: No auth guards on any route
- **File**: `frontend/src/router/index.ts`
- **Problem**: No `beforeEach` navigation guard. All routes are publicly accessible, including `/projects`.
- **Impact**: Authenticated pages are accessible without login.
- **Fix**: Add `beforeEach` that redirects to `/login` if no token.

### TKT-143: TicketDetail.vue uses `alert()` — blocks main thread
- **File**: `frontend/src/views/TicketDetail.vue` (lines 69, 71, 80)
- **Problem**: Browser `alert()` blocks rendering and provides terrible UX.
- **Impact**: Poor user experience, especially on error paths.
- **Fix**: Use a toast notification component or inline error messages.

### TKT-144: AIAssistant.vue shows raw API keys in dropdown
- **File**: `frontend/src/views/AIAssistant.vue` (line 21)
- **Problem**: `{{ agent.api_key || 'N/A' }}` displays full API keys.
- **Impact**: Security risk — keys visible in UI and browser devtools.
- **Fix**: Mask keys: `api_key ? api_key.substring(0, 6) + '...' : 'N/A'`.

### TKT-145: AIAssistant.vue `extractTicketTitle` extracts wrong group
- **File**: `frontend/src/views/AIAssistant.vue` (lines 357-361)
- **Problem**: `match2[1]` captures `bug|issue|ticket|feature`, not the actual title. Should use `match[2]` from the first regex.
- **Impact**: Created tickets get titles like "bug" instead of the actual description.
- **Fix**: Use the first regex's capture group for the title.

### TKT-146: `handleQuickAction` is convoluted and can fire multiple times
- **File**: `frontend/src/views/AIAssistant.vue` (lines 227-237)
- **Problem**: `findLast` returns the last element, then `find` finds it again, then `forEach` iterates ALL items. If any labels duplicate, multiple actions fire.
- **Impact**: Unexpected behavior, potential duplicate API calls.
- **Fix**: Simplify to `const action = quickActions[0]` or a clear first-action pattern.

### TKT-147: ProjectDetail.vue is a 10-line placeholder
- **File**: `frontend/src/views/ProjectDetail.vue`
- **Problem**: Route exists with nested children (tickets, tickets/:ticketId, ai) that can never be reached through this stub.
- **Impact**: Entire project detail sub-routing is broken.
- **Fix**: Implement the project detail view with proper ticket list and navigation.

### TKT-148: ProjectList.vue cards are visually clickable but have no `@click` handler
- **File**: `frontend/src/views/ProjectList.vue` (lines 54-55, 106)
- **Problem**: Cards have `cursor: pointer` CSS but no click navigation. Hardcoded URL `http://localhost:3001/api/v1/projects`.
- **Impact**: No navigation to project detail.
- **Fix**: Add `@click` to navigate, use `import.meta.env.VITE_API_URL`.

### TKT-149: TicketBoard.vue uses hardcoded fake users
- **File**: `frontend/src/views/TicketBoard.vue` (lines 79-86)
- **Problem**: `getTicketAssignee()` returns hardcoded `{ id: 'u1', first_name: 'Alice', ... }`. Will never match real API data.
- **Impact**: Assignee names always show as Alice/Bob.
- **Fix**: Accept an users array prop or fetch from an API endpoint.

### TKT-150: `openCreateModal` called in template but never defined
- **File**: `frontend/src/views/TicketBoard.vue` (line 135)
- **Problem**: Template calls `@click="openCreateModal"` but the function doesn't exist.
- **Impact**: `ReferenceError` when clicking "New Ticket" button.
- **Fix**: Implement the create ticket modal or function.

### TKT-151: App.vue missing `lang="ts"` and has no navigation/error boundary
- **File**: `frontend/src/App.vue`
- **Problem**: Project is TypeScript-configured but the component doesn't declare `lang="ts"`. No header, nav, or error boundary.
- **Impact**: Type checking inconsistent, no persistent UI chrome.
- **Fix**: Add `lang="ts"`, create a header/navigation component.

### TKT-152: No reusable components despite duplicated UI patterns
- **File**: `frontend/src/components/` (empty directory)
- **Problem**: Every view repeats button, badge, card, and input patterns. No shared component library.
- **Impact**: High maintenance cost, inconsistent styling.
- **Fix**: Extract common patterns into `components/` — Button, Badge, Card, Input, Modal.

---

## P5 - INFRASTRUCTURE & DEVOPS

### TKT-153: No tests run in CI
- **File**: `.github/workflows/ci.yml`
- **Problem**: Backend job runs lint + build but skips `npm test`. Frontend job runs lint + build, no `npm run typecheck`.
- **Impact**: Broken tests can merge to main without detection.
- **Fix**: Add `npm test` step to backend job, `npm run typecheck` before frontend build.

### TKT-154: No security headers in nginx.conf
- **File**: `nginx.conf` (root) and `frontend/nginx.conf`
- **Problem**: Zero security headers — no `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`.
- **Impact**: Vulnerable to clickjacking, XSS, MIME-type sniffing.
- **Fix**: Add security headers to both nginx configs.

### TKT-155: API service has no restart policy in docker-compose
- **File**: `docker-compose.yml`
- **Problem**: Only `postgres` has `restart: unless-stopped`. API and frontend will not auto-restart on crash.
- **Impact**: Outage after any unhandled exception.
- **Fix**: Add `restart: unless-stopped` to `api` and `frontend` services.

### TKT-156: API service has no healthcheck in docker-compose
- **File**: `docker-compose.yml`
- **Problem**: `api` depends on postgres being healthy but has no healthcheck itself. No way for orchestrators to verify API is operational.
- **Fix**: Add healthcheck to API service.

### TKT-157: All containers run as root
- **Files**: `backend/Dockerfile`, `frontend/Dockerfile`, root `Dockerfile`
- **Impact**: If an attacker achieves code execution, they have root in the container.
- **Fix**: Add non-root user in each Dockerfile's final stage.

### TKT-158: `npm ci --only=production` is deprecated in backend/Dockerfile
- **File**: `backend/Dockerfile` (line 11)
- **Problem**: `--only` flag is deprecated in npm 7+.
- **Fix**: Use `npm ci --omit=dev`.

### TKT-159: Backend Dockerfile doesn't use exec form for CMD
- **File**: `backend/Dockerfile` (line 13)
- **Problem**: `CMD ["node", "src/index.js"]` — node won't receive SIGTERM properly, causing slow graceful shutdowns.
- **Fix**: Use `CMD ["exec", "node", "src/index.js"]`.

### TKT-160: No Docker resource limits
- **File**: `docker-compose.yml`
- **Problem**: No `deploy.resources.limits` on any service.
- **Impact**: Runaway process can consume all host resources.
- **Fix**: Add memory/CPU limits.

### TKT-161: Orphaned root `package-lock.json` without `package.json`
- **File**: `package-lock.json` (root)
- **Problem**: Lockfile has `"workspaces": ["backend", "frontend"]` but no matching `package.json`. This will cause `npm ci` at root to fail.
- **Fix**: Either create a root `package.json` or delete the orphaned lockfile.

### TKT-162: `vue-tsc` version mismatch with TypeScript
- **File**: `frontend/package.json`
- **Problem**: `vue-tsc: ^1.8.25` only fully supports TypeScript 4.x, but project uses `typescript: ^5.3.2`.
- **Fix**: Update to `vue-tsc@^2.x` for TypeScript 5 support.

### TKT-163: No `.gitignore` for backend/ and frontend/
- **Files**: `backend/.dockerignore` (exists), `frontend/.dockerignore` (exists) — but root `.gitignore` may be missing entries
- **Problem**: Root `.gitignore` covers `node_modules/` and `dist/` but doesn't explicitly exclude backend/frontend-specific patterns.
- **Fix**: Ensure both `backend/.gitignore` and `frontend/.gitignore` exclude `.env`, `coverage/`, `*.log`, `logs/`, `.DS_Store`.

### TKT-164: No Docker build test in CI
- **File**: `.github/workflows/ci.yml`
- **Problem**: Neither Dockerfile is built in CI. A change in either Dockerfile could silently break production images.
- **Fix**: Add `docker build` steps for both Dockerfiles in CI.

### TKT-165: Server version disclosure in nginx
- **File**: `nginx.conf`
- **Problem**: `server_tokens on` (default) reveals nginx version in `Server` header.
- **Fix**: Add `server_tokens off;`.

### TKT-166: No gzip compression in nginx
- **File**: `nginx.conf`
- **Problem**: No compression directives — all text assets served uncompressed.
- **Fix**: Enable gzip/brotli compression.

### TKT-167: No static asset caching in nginx
- **File**: `nginx.conf`
- **Problem**: All assets (JS, CSS, images) served without `Cache-Control` headers.
- **Fix**: Add `expires 1y; add_header Cache-Control "public, immutable";` for static assets.

### TKT-168: `AGENT.md-UPDATE.md` is stale and misleading
- **File**: `AGENTS-MD-UPDATE.md`
- **Problem**: Claims "All changes verified and repo is ready for agent work" but the repo has P0 issues (unmounted routes, broken builds). This is false.
- **Impact**: Could mislead future agents into thinking the code is functional when it isn't.
- **Fix**: Delete or clearly mark as historical/deprecated.

---

## Summary by Category

| Category | Count |
|---|---|
| P0 - Critical (broken) | 8 |
| P1 - Security | 8 |
| P2 - Broken at runtime | 12 |
| P3 - Backend quality | 11 |
| P4 - Frontend quality | 14 |
| P5 - Infrastructure/DevOps | 16 |
| **Total** | **69** |
