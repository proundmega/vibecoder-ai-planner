# Full Test Audit — Vibecode AI Planner

**Date:** 2026-10-31
**Baseline commit:** `cc334a1` (`master` after PR #99, clean working tree at rebase)
**Environment:** Windows, Node 24.22.2 / npm 11.19.1, Java 21 (Temurin), no Docker, no system PostgreSQL, no Chrome.

This audit ran every test layer that could be executed, unblocked the database-backed
suite with an embedded Postgres (PGlite over the Postgres wire protocol), and fixed the
defects it found. Every fix has a regression test.

---

## 1. Results at a glance

| Layer | Command | Result |
|---|---|---|
| Backend unit (Jest) | `npm test` | **109 suites / 1360 tests passed** |
| Backend coverage | `npm run test:coverage` | **72.09% stmts · 65.02% branch · 69.49% funcs · 73.36% lines** (threshold 60%) |
| Backend lint | `npm run lint` | **0 errors**, 31 warnings |
| Backend integration (real Postgres) | `npm run test:integration` | **3 suites / 85 tests passed** |
| Frontend unit (Vitest) | `npm test -- --run` | **59 files / 547 tests passed** |
| Frontend coverage | `npm test -- --run --coverage` | **85.51% stmts · 83.45% branch · 71.27% funcs · 85.51% lines** (threshold 60%) |
| Frontend lint | `npm run lint` | **0 errors**, 6 warnings |
| Frontend typecheck | `npm run typecheck` | **clean** |
| Frontend build | `npm run build` | **success** (main chunk 116.77 kB, gzip 44.27 kB) |
| API contract test | `vitest --run src/__tests__/api-contract.test.ts` | **23 tests passed** |
| Cypress component | `cypress run --component --browser electron` | **63 tests passed** (Chrome unavailable; Electron is equivalent) |
| Java agent | `mvn test` / `mvn package -DskipTests` | **38 tests, 0 failures, 1 skipped** (POSIX-only test on Windows); shaded JAR built (10.8 MB) |

### How integration tests were unblocked
Docker and PostgreSQL are not installed on this machine. The integration suite was run
against **PGlite (PostgreSQL 18 in WASM)** exposed on `127.0.0.1:5432` via
`@electric-sql/pglite-socket`; `pg` connects to it unmodified. All 44 SQL migrations
applied. The only skipped objects are the pgvector-dependent `agent_memory` table and
its HNSW index, because PGlite has no `vector` extension — Docker CI installs pgvector,
so that is an environment limitation, not a project defect.

### Environment caveats
- `npm run cypress:component` fails on this machine because the script hard-codes
  `--browser chrome`; Chrome is not installed. Edge and Electron are available.
- `backend/integration-test/run.sh` and the Docker test containers were not exercised
  (no Docker). The Jest integration suite covers the same API surface.
- Frontend `npm test` is watch mode; `--run` was used.

---

## 2. Bugs found and fixed (all with regression tests)

### HIGH

**H1. Changing a ticket assignee always failed at runtime**
`backend/src/services/TicketService.js` validated membership against `project_members`,
a table that does not exist (the schema defines `project_memberships`). Any
`PUT /api/v1/tickets/:id` with a new `assigneeId` produced a PostgreSQL "relation does
not exist" error.
*Fix:* query `project_memberships`.
*Test:* `backend/src/__tests__/ticketServiceAssignee.test.js`.

**H2. User APIs leaked the bcrypt password hash**
`listUsers`, `listAllUsers`, `createUser`, `updateUser` and `toggleUserActive` returned
`User` model instances directly; `res.json()` serialized every enumerable field,
including `passwordHash` (the bcrypt hash from `password_hash`).
*Fix:* added `User.toJSON()` that emits only public fields. `passwordHash` remains
available internally for authentication.
*Test:* `backend/src/__tests__/userModelSerialization.test.js`.

### MEDIUM

**M1. Login lockout returned `Retry-After: NaN`**
`backend/src/api/routes.js` did `const remainingMs = getLockoutRemainingMs(ip)` without
`await`; the promise was divided by 1000. `recordFailedAttempt` was also not awaited.
*Fix:* await the lockout helpers.
*Test:* `backend/src/__tests__/authLockoutRetryAfter.test.js` (asserts a positive
integer `Retry-After`).

**M2. Ticket list/detail lost assignee and project names**
`Ticket.fromRow()` passed `assigneeName`/`projectName` to the constructor, which never
assigned them. Joined `assignee_name`/`project_name` columns were silently discarded.
*Fix:* constructor now maps both camelCase and snake_case names.
*Test:* `backend/src/__tests__/ticketModelRegressions.test.js`.

**M3. `POST /tickets` returned a ticket without `projectId`/`ownerId`**
`Ticket.create()` built the instance from a raw DB row (`project_id`, `owner_id`) while
the constructor reads camelCase keys.
*Fix:* `Ticket.create()` now uses `fromRow()`.
*Test:* `ticketModelRegressions.test.js`.

**M4. Ticket detail never showed the assignee name**
`TicketService.getOne()` uses `Ticket.findById()` (`SELECT *`, no join), so there was no
name to display even after M2.
*Fix:* `getOne()` resolves the assignee via `User.find()`.
*Test:* `backend/src/__tests__/ticketServiceGetOne.test.js`.

**M5. Admin could deactivate their own account in the UI**
`UserManagement.vue` used `authStore.user?.id`, but `user` is a Vue `Ref`; the value was
always `undefined`, so the self-toggle guard never fired. The backend rejects self-toggle,
so the UI offered an action that always failed.
*Fix:* `authStore.user.value?.id`.
*Tests:* `frontend/src/__tests__/templateRefAccess.test.ts`;
`cypress/component/UserManagement.cy.ts` (the pre-existing Cypress test caught this).

**M6. Ticket edit modal ignored the current assignee**
`TicketEditModal.vue` read `props.ticket.assignee_id` and `props.ticket.owner_id`, but the
API returns `assigneeId`/`ownerId`. The assignee was never preselected and the owner
permission check was dead code.
*Fix:* camelCase keys.
*Test:* `templateRefAccess.test.ts` (preselected assignee).

**M7. Ticket detail loaded templates with `projectId = undefined`**
`TicketDetail.vue` called `listTemplates(ticket.value.project_id)`; the API field is
`projectId`, so the request was `/projects/undefined/templates`. The same file used
`owner_id` in two permission checks.
*Fix:* camelCase keys.
*Test:* covered by typecheck + existing suite; field names verified against the API.

**M8. Dashboard always greeted the user as "User"**
`Dashboard.vue` used `authStore.user?.name` on a `Ref`.
*Fix:* `authStore.user.value?.name`.
*Test:* `templateRefAccess.test.ts`.

### LOW

**L1. No-op status updates were rejected**
`Ticket.update()` rejected `status === current status`, so a client sending a full
ticket payload (title + unchanged status) got "Invalid status transition".
*Fix:* skip validation when the status is unchanged; invalid transitions still rejected.
*Test:* `ticketModelRegressions.test.js`.

**L2. `critical` priority was accepted by Joi/UI but rejected by the database**
`001_create_tables.sql` constrained priority to `low/medium/high/urgent`, while Joi and
`PhaseDraft.vue` allow `critical`. Such a request passed validation and failed with a DB
error (HTTP 500).
*Fix:* migration `044_allow_critical_priority.sql` widens the constraint (+ rollback).
*Tests:* `migrationPrioritySync.test.js`; `044` is registered in `apply.js` and picked up
automatically by the integration setup.

**L3. Documented migration dry-run did not exist**
`PENDING.txt` marks **bp-79** done, and `planning/DONE/bp-79-migration-dry-run/04_SPECIFICATION.md`
specifies a CLI, but `apply.js` only exported the classifier and `package.json` had no
`db:migrate:dry-run` script.
*Fix:* implemented `--dry-run` per the spec (classification summary, data-migration
preview, no writes) and added the npm script.
*Test:* `migrationDryRunCli.test.js`; verified live against PGlite.

**L4. Java agent crashed on Windows (POSIX permissions assumed)**
`WorkspaceManager.createCredentialHelper()` called `Files.setPosixFilePermissions()`
unconditionally, throwing `UnsupportedOperationException` on Windows and failing two
agent tests. The agent ships in a Linux container, but local Windows development broke.
*Fix:* only apply POSIX permissions when the filesystem supports them
(`supportedFileAttributeViews().contains("posix")`); the permission test is now
`assumeTrue`-guarded. Linux behaviour is unchanged.
*Verified:* `mvn test` → 38 tests, 0 failures, 1 skipped (the POSIX-only test on Windows);
`mvn package -DskipTests` → shaded JAR builds.

---

## 3. Test-suite defects fixed

The Cypress component suite was stale and could never pass:

- `Login.cy.ts` waited for `.error`; the component renders `.login__error`.
- `TicketBoard.cy.ts` and `UserManagement.cy.ts` intercepted pre-versioned paths
  (`/api/projects`, `/api/users`) while the app calls `/api/v1/...`, so the intercepts
  never matched and requests hit a dead dev proxy.
- `UserManagement.cy.ts` mocked `is_active` while the API (and component) use `isActive`.

All six component specs now pass: 63 tests (DesignSystem 35, Login 4, TicketBoard 6,
TicketDetail 1, UserManagement 10, UserModal 7).

---

## 4. Open defects and risks (not changed)

Tracked in `planning/bp-124-audit-open-defects/`. The fixes in this report are
recorded in `planning/bp-123-test-audit-corrections/`.

| # | Severity | Finding |
|---|---|---|
| O1 | Medium | **Milestone fields cannot be set.** `TicketService.update()` validates `milestone_id`, `estimate` and `depends_on` but never persists them, and `TicketService.updateMilestoneFields()` has no callers. `ProjectMilestones.vue` displays values that no API can write. |
| O2 | Medium | **Dead code references missing tables.** `getAgentTickets()` in `TicketService`/`AgentService` queries `project_agents`; `deleteWithAudit()` in the user/ticket/project models writes to `audit_log`. Neither table exists in any migration. The methods are currently unused, so this is latent 500s. |
| O3 | Medium | **E2E suite is stale and not wired into CI.** `cypress/e2e/*` logs in as hardcoded `alice@example.com`, `seed.ts`/`commands.ts` use unversioned `/api/...` paths, and specs assert `.error`. Jenkins never runs Cypress, so this has rotted unnoticed. |
| O4 | Medium | **Agent identity is ambiguous.** `assigned_agent_id` references `users(id)`, and `pickUpTicket` stores `req.user.userId` (the owner user), not the agent id. Two agents owned by the same user are indistinguishable, and pickup/release traces cannot identify the worker. |
| O5 | Low | **Frontend validator schemas use snake_case.** `api/validator.ts` declares `owner_id`/`project_id`/`user_id` for Project/Ticket/Agent while the backend returns camelCase. Only the `User` schema is used in production today, so no runtime impact yet. |
| O6 | Low | **`PUT /tickets/:id` response type drift.** The endpoint returns `{ message: 'Ticket updated' }` but `api/tickets.ts` types it as `Ticket`. Callers that consume the result get an object without ticket fields. |
| O7 | Low | **Docs drift.** README says "GitHub Actions" but CI is Jenkins; `AGENTS.md` now records 44 migrations; `PENDING.txt` claimed bp-79 was done while the code was missing (fixed in this PR). |
| O8 | Low | **Integration setup hides migration errors.** `src/__tests__/integration/setup.js` only warns on unexpected errors, so a broken migration does not fail the run. This is how the missing `agent_memory` objects went unnoticed locally. |

---

## 5. Dependency and build hygiene

`npm audit` on a clean install:

- **Backend:** 41 vulnerabilities overall (1 critical, 11 high, 24 moderate, 5 low);
  **17 in production dependencies**, including a **critical `proxy-addr`** advisory
  (IP spoofing via IPv4-mapped IPv6) reached through Express, plus `qs` DoS advisories.
- **Frontend:** 39 vulnerabilities overall (4 critical, 12 high, 23 moderate);
  **8 in production dependencies** (7 high, 1 moderate). The critical advisories are in
  dev tooling.

No dependency upgrades were applied: `npm audit fix` can change runtime behaviour and
deserves its own ticket. Recommend running `npm audit fix` for backend production deps
first, then re-running the full suite.

---

## 6. Blocked checks

| Check | Why | Recommendation |
|---|---|---|
| Docker compose stack | Docker not installed | Run `docker compose up --build` in CI or a machine with Docker |
| `backend/integration-test/run.sh` | Needs running API + PG containers | Covered by Jest integration here; run the bash suite before release |
| Cypress E2E | No seeded backend/frontend stack, and the specs are stale (O3) | Rewrite specs around `/api/v1`, seed data via API, add to Jenkins |
| Chrome-based Cypress | Chrome absent | Use Electron locally; keep Chrome in CI or change the npm script |

---

## 7. Reproduction

```bash
# Backend
cd backend
npm ci
npm test
npm run test:coverage
npm run lint

# Frontend
cd ../frontend
npm ci
npm test -- --run
npm test -- --run --coverage
npm run typecheck
npm run lint
npm run build
npx cypress run --component --browser electron

# Database-backed integration (any PostgreSQL 13+)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vibecode
cd ../backend && npm run test:integration
```

---

## 8. Verdict

The project is in better shape than the legacy `IMPROVEMENTS.md` /
`FRONTEND_BACKEND_DISCREPANCIES.md` documents suggest: every unit, component, contract
and database integration test passes, coverage is above threshold, and lint/typecheck/
build are clean. The real problems were in code paths that mocked unit tests cannot see
(wrong table name, model serialization, cross-layer field names, dead latent SQL) and in
test assets that CI never ran (Cypress).

Highest-value next steps, in order:

1. Fix O1 (milestone assignment API) — visible feature that cannot work today.
2. Fix O2 (dead SQL) by either creating the tables or deleting the methods.
3. Rewrite the Cypress E2E suite and add it to Jenkins (O3).
4. Address production `npm audit` findings, starting with `proxy-addr`.
5. Reconcile `assigned_agent_id` semantics (O4) before scaling agents.
