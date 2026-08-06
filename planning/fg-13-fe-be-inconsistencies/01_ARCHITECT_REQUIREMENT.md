# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-08-06
**Date completed**:
**Author**: AI Assistant
**Scope**: Both
**Priority**: P1
**Effort**: Medium

---

## Requirement

A full frontend↔backend API surface audit (route inventory vs. client inventory, response shapes, permissions, statuses, auth contract) found **7 inconsistencies**. Three render existing UI features completely broken (404s), one breaks a TicketDetail section, and the rest are latent drift (dead generated client, missing WebSocket proxy config).

**Current behavior**: Feature pages (Compute Nodes, Milestones), the Blocked/In-Progress phase feedback actions, and the TicketDetail planning-usage section all fail against the backend.
**Expected behavior**: Every frontend API call reaches a mounted backend endpoint; the generated API client and proxy config match the real backend surface.

The 7 findings:

| # | Finding | Frontend | Backend | Impact |
|---|---------|----------|---------|--------|
| F1 | `POST /api/v1/tickets/:ticketId/feedback` does not exist | `PhaseBlocked.vue:23`, `PhaseInProgress.vue:35` | no `feedback` route anywhere (grep: 0 hits) | P0 — Send Reply / Send Feedback buttons always 404 — **RESOLVED: Option C — reuse existing `POST /tickets/:ticketId/messages` with `messageType='feedback'` (frontend-only fix)** |
| F2 | `compute-nodes` router never mounted | `api/computeNodes.ts`, `views/ComputeNodes.vue`, `components/ComputeNodeModal.vue` → `/api/v1/compute-nodes*` | `api/compute-nodes.js` exists but not in `v1/index.js` mounts | P1 — whole page 404s |
| F3 | `milestones` router never mounted | `api/milestones.ts`, `views/ProjectMilestones.vue`, `components/NewMilestoneModal.vue`, `components/MilestoneProgress.vue` → `/api/v1/projects/:id/milestones`, `/api/v1/milestones/:id*` | `api/milestones.js` exists but not mounted | P1 — whole page 404s |
| F4 | `deployments` router never mounted | `api/deployments.ts` → `/api/v1/tickets/:id/deploy`, `/api/v1/deployments/:id*`, `/api/v1/projects/:id/environments` (no views use it) | `api/deployments.js` exists but not mounted; **contains latent auth bugs** (see below) | P3 — dead FE module — **RESOLVED: Option A — mount router + fix auth bugs** |
| F5 | Planning usage URLs lack `/api/v1` prefix | `api/client.ts:208` `getTicketPlanningUsage`, `:240` `getPlanningFileUsage` → `/tickets/:id/planning/usage` (relative URL) | serves `/api/v1/tickets/:ticketId/planning/usage` | P1 — `TicketDetail.vue:315` usage section always fails (Vite proxy only handles `/api`, nginx serves index.html) |
| F6 | Generated API client stale / wrong | `api/generated/core/OpenAPI.ts` BASE `http://localhost:3001/api`, URL templates lack `/v1`; `SystemService.getApiMetrics` → `/api/api/metrics` (double prefix); `AgentsService.postAgentsAgentIdRotateKey` → literal `:agentId` | real API under `/api/v1/*` | P3 — unused by prod code (types-import test only), but spec generation is out of sync |
| F7 | Terminal WebSocket proxy not configured | `views/TerminalView.vue:32` connects `ws(s)://<host>/api/terminal/:agentId?token=...` | `createTerminalWSS` + `server.on('upgrade')` in `index.js` exist | P2 — WS upgrade fails in dev (vite proxy lacks `ws: true`) and prod (nginx lacks `Upgrade`/`Connection` headers) |

**F4 latent auth bugs (discovered during audit, must be fixed as part of the mount):**
1. `POST /projects/:projectId/environments` and `DELETE /environments/:id` use `requireAnyPermission('PROJECT_ADMIN')` — `PROJECT_ADMIN` is a **role name, not a permission code** (verified against the 26 codes seeded in `005_permission_system.sql`). `PermissionService.hasAnyPermission` only matches DB codes and has no super_admin short-circuit → these 2 routes would **403 for everyone, forever**.
2. `POST /tickets/:ticketId/deploy`, `POST /deployments/:id/rollback`, `PATCH /deployments/:id/status` have **no permission check at all** (`verifyToken` + `validate` only) → any authenticated user could trigger deploys/rollbacks/status changes.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check

- [x] API routes exist for all features — YES (29 route files inventoried; only F1 has no route at all)
- [x] Routes are mounted: `backend/src/api/v1/index.js` — NO for compute-nodes (F2), milestones (F3), deployments (F4); the orphaned `ticketAttachment.js`/`ticketPlanning.js` routers are also unmounted (superseded by inline routes in `v1/index.js`)
- [x] Services exist: `DeployService.js`, `MilestoneService.js`, `ProvisioningService.js`, `PhaseService.js` — YES (only HTTP wiring is missing)
- [x] OpenAPI JSDoc annotations exist — YES for most; F1 needs annotations; F6 needs spec regeneration

### Frontend API Client Check

- [x] API clients exist: `frontend/src/api/` — YES (20 modules; all use `/api/v1/` prefix EXCEPT the two `client.ts` helpers in F5)
- [x] API client functions cover all needed endpoints — NO for F1 (feedback), F2-F4 (unmounted), F5 (prefix), F6 (generated)

### Frontend UI Check

- [x] Views exist for all affected features: `PhaseFlow.vue` + `phases/PhaseBlocked.vue`, `phases/PhaseInProgress.vue`, `ComputeNodes.vue`, `ProjectMilestones.vue`, `TicketDetail.vue`, `TerminalView.vue`
- [x] Routes exist in `frontend/src/router/index.ts` — YES

### Integration Check

- [x] Frontend API client can call existing backend endpoints — NO for F1–F5
- [x] Response shapes match (snake_case vs camelCase) — YES for everything else (usage, billing, memory, auth verified)
- [x] Auth tokens are used correctly — YES (Bearer JWT; agents via `X-API-Key`)
- [x] Error handling matches existing patterns — YES

### Key Insight

This is a **mix of FRONTEND-ONLY, BACKEND-ONLY, and CONFIG fixes**:

- **F1**: FRONTEND-ONLY — retarget the two views to the existing `POST /tickets/:ticketId/messages` endpoint with `messageType='feedback'` (no backend change; `ticket_messages.message_type` is an unconstrained VARCHAR, verified in migration 011)
- **F2, F3**: BACKEND-ONLY — mount the existing routers in `v1/index.js`
- **F4**: BACKEND-ONLY — mount the existing router **and fix its latent auth bugs** (role name used as permission code → permanent 403; three routes with no permission check)
- **F5**: FRONTEND-ONLY — add the `/api/v1` prefix to the two `client.ts` helpers
- **F6**: FRONTEND (generated code) — fix spec generation and regenerate; BASE must point at the proxied path
- **F7**: CONFIG — `vite.config.ts` proxy `ws: true`, nginx `Upgrade`/`Connection` headers

The audit confirmed everything else consistent: all endpoint paths/methods, auth shape `{token, user}`, `/auth/me` `{user, authenticated}`, ticket statuses (backlog/in_progress/review/done), 10 phases, all 26 permission codes, usage/billing/memory response shapes.

---

## Scope

### In Scope
- F1: Retarget `PhaseBlocked.vue` and `PhaseInProgress.vue` feedback calls from the non-existent `/tickets/:id/feedback` to the existing `POST /tickets/:id/messages` with `{ messageType: 'feedback', content }` (frontend-only, no backend change)
- F2: Mount `compute-nodes` router in `backend/src/api/v1/index.js` (5 endpoints)
- F3: Mount `milestones` router in `backend/src/api/v1/index.js` (5 endpoints)
- F4: Mount `deployments` router in `backend/src/api/v1/index.js` AND fix latent auth bugs: replace `requireAnyPermission('PROJECT_ADMIN')` (non-existent permission code → permanent 403) with `PROJECT_UPDATE`; add `TICKET_UPDATE` to `/tickets/:id/deploy` and `/deployments/:id/rollback`, `TICKET_STATUS_CHANGE` to `/deployments/:id/status`
- F5: Fix `getTicketPlanningUsage` / `getPlanningFileUsage` URLs in `frontend/src/api/client.ts` to `/api/v1/...`
- F6: Fix OpenAPI spec / generation so `frontend/src/api/generated/` matches the real API (BASE, `/v1` prefix, `rotate-key` template, metrics path)
- F7: Add `ws: true` to `frontend/vite.config.ts` proxy; add `Upgrade`/`Connection` headers to `frontend/nginx.conf`
- Regression tests for every fix (bug-fix protocol)

### Out of Scope
- New UI components or pages
- Redesigning the phase system, permissions, or auth contract (verified consistent)
- Adding a dedicated `/feedback` backend endpoint (deferred — revisit when the agent-side blocked/feedback loop is built; tracked in Pending Scope Items)
- Adding a `TICKET_COMMENT`-style permission check to the existing `POST /tickets/:id/messages` endpoint (pre-existing behavior; would break agent message posting)
- Deleting the dormant `frontend/src/api/deployments.ts` module (kept for a future Deployments UI)
- Regenerating/migrating the `ticketAttachment.js`/`ticketPlanning.js` orphaned routers (they are superseded by inline routes; removal is cosmetic)
- Renaming/refactoring verified-consistent endpoints

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-100 (planning usage tracking) | `getPlanningFileUsage` (F5) is exported but has no call sites — usage history per file is backend-complete but has no UI | UX | bp-XX-planning-file-usage-ui | ☐ |
| 2 | bp-78 (CSP reporting) | `frontend/src/api/cspViolations.ts` supports `directive`/pagination filters; CspViolations.vue is the only consumer | UX | (none — consistent) | ☐ |
| 3 | bp-04 (usage billing) | `postWithHeaders` in `client.ts` has zero production call sites (tests only) — dead export | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 4 | fg-06 (agents API paths) | Generated services (F6) are only referenced by `generatedTypesImport.test.ts`; consider deleting or regenerating to avoid drift | Developer experience | (covered by F6) | ☐ |
| 5 | bp-80 (pgbouncer) | Orphaned routers `ticketAttachment.js`/`ticketPlanning.js`/`compute-nodes.js` patterns suggest a route-mount audit script could prevent regressions | Developer experience | bp-XX-route-mount-audit | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

For internal tracking — these are the same items above but without the "User Notified" column. Create follow-up tickets for each item.

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-100 | Planning file usage history has no UI | UX | bp-XX-planning-file-usage-ui |
| 2 | bp-78 | — | UX | (none) |
| 3 | bp-04 | `postWithHeaders` dead export | Developer experience | bp-XX-dead-code-cleanup |
| 4 | fg-06 | Generated services unused in prod | Developer experience | (covered by F6) |
| 5 | bp-80 | Route-mount drift audit tooling | Developer experience | bp-XX-route-mount-audit |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/v1/index.js` | MODIFY | Mount `compute-nodes` (F2), `milestones` (F3), `deployments` (F4) routers |
| `backend/src/api/deployments.js` | MODIFY (F4) | Fix `requireAnyPermission('PROJECT_ADMIN')` → `PROJECT_UPDATE`; add `TICKET_UPDATE`/`TICKET_STATUS_CHANGE` to the 3 unguarded routes; add JSDoc |
| `frontend/src/views/phases/PhaseBlocked.vue` | MODIFY (F1) | Post reply to `/api/v1/tickets/:id/messages` with `messageType='feedback'` |
| `frontend/src/views/phases/PhaseInProgress.vue` | MODIFY (F1) | Post feedback to `/api/v1/tickets/:id/messages` with `messageType='feedback'` |
| `frontend/src/api/client.ts` | MODIFY (F5) | Add `/api/v1` prefix to planning usage helpers |
| `frontend/src/api/generated/` | REGENERATE (F6) | Fix BASE/spec; regenerate services/models |
| `frontend/vite.config.ts` | MODIFY (F7) | `ws: true` on `/api` proxy |
| `frontend/nginx.conf` | MODIFY (F7) | `Upgrade`/`Connection` headers on `/api/` location |
| `config` | NONE | No env vars |
| `database` | NONE | No migrations (F1 verified: `ticket_messages.message_type` is unconstrained VARCHAR — migration 011) |

---

## Known Unknowns

1. **[F1 feedback storage]**: Where should feedback be persisted? Options: `ticket_phases` metadata, `ticket_messages`, or a new table. **Resolution**: decide in 02_ARCHITECT_DESIGN (Option A: reuse `ticket_messages` with type `feedback` — no migration).
2. **[F6 spec source]**: `openapi-generated.json` may be stale relative to `openapi-spec.js` JSDoc. **Resolution**: regenerate via `npm run generate:spec` and inspect diff before committing.
3. **[F7 prod WS]**: nginx `location /api/` has no upgrade headers; TerminalView may be dev-only today. **Resolution**: confirm with user whether prod terminal support is required (still add headers — harmless).
4. **[F2/F3 auth]**: compute-nodes/milestones routers use `verifyToken` + `requireAnyPermission`; verify no permission-code drift when mounting. **Resolution**: compare against the 26-permission list during implementation.

---

## Important Design Decisions

**RESOLVED by user on 2026-08-06** — the two previously-open decisions have been confirmed:

1. **F1 — feedback endpoint: Option C (REUSED)** — Do NOT add a backend endpoint. Retarget the frontend calls (`PhaseBlocked.vue`, `PhaseInProgress.vue`) to the existing `POST /api/v1/tickets/:ticketId/messages` with body `{ messageType: 'feedback', content }`. The messages endpoint already accepts JWT users (`verifyTokenOrAgent`), and `ticket_messages.message_type` has no CHECK constraint so `'feedback'` is storable. No migration, no new validator, no contract-test backend changes. Accepted trade-offs: `postMessage` has no `TICKET_COMMENT` permission check (any authenticated user can post any message type — pre-existing behavior, out of scope); the agent never consumes feedback yet (future ticket).
   - Rejected alternatives (documented in 02): Option A (dedicated `/feedback` endpoint — duplicate of `postMessage`, saves for when the agent blocked/feedback loop is built), Option B (remove the feedback UI — destroys the only human-input channel in the phase flow).

2. **F4 — deployments router: Option A (MOUNT + FIX)** — Mount the existing `deployments` router in `v1/index.js` AND fix its latent auth bugs in the same ticket: `PROJECT_ADMIN` (a role name, not one of the 26 permission codes — would 403 for everyone) → `PROJECT_UPDATE` on the two environment routes; add `TICKET_UPDATE` to `/tickets/:id/deploy` and `/deployments/:id/rollback`, `TICKET_STATUS_CHANGE` to `/deployments/:id/status`. Verified: `updateDeploymentStatus` is a direct DB update with no external webhook receiver, so JWT permission checks are safe. `frontend/src/api/deployments.ts` stays (dormant, for a future UI).
   - Rejected alternative (documented in 02): Option B (delete router + `DeployService` + tests + FE module — destroys a designed, tested feature).

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Frontend API] F1: `PhaseBlocked.vue` Send Reply posts `POST /api/v1/tickets/:id/messages` with `{ messageType: 'feedback', content }` (asserted in component/unit tests)
2. [ ] [Frontend API] F1: `PhaseInProgress.vue` Send Feedback posts the same endpoint/body; a `ticket_messages` row with `message_type='feedback'` is created
3. [ ] [Backend API] F2/F3/F4: `GET /api/v1/compute-nodes`, `/api/v1/projects/:id/milestones`, `/api/v1/tickets/:id/deployments` (and all sub-routes) return 200, not 404
4. [ ] [Backend API] F4: `POST /api/v1/projects/:id/environments` and `DELETE /api/v1/environments/:id` use `PROJECT_UPDATE` (no more `PROJECT_ADMIN` role-as-code → project_admin role can actually create environments)
5. [ ] [Backend API] F4: `POST /tickets/:id/deploy` and `POST /deployments/:id/rollback` require `TICKET_UPDATE`; `PATCH /deployments/:id/status` requires `TICKET_STATUS_CHANGE` — `user` role gets 403
6. [ ] [Backend API] F2/F3/F4: routers mounted in `v1/index.js` with `verifyToken` auth matching the frontend calls
7. [ ] [Backend API] New/modified controller/service has test cases in a test file (CREATED or EXTENDED)
8. [ ] [Backend API] Integration tests pass for the new endpoints
9. [ ] [Frontend API] F5: `getTicketPlanningUsage()` calls `GET /api/v1/tickets/:id/planning/usage` (asserted in client tests)
10. [ ] [Frontend API] F5: `TicketDetail.vue` planning usage section loads real data (no relative-URL 404)
11. [ ] [Frontend API] F6: regenerated `api/generated/` has correct BASE (no hardcoded `http://localhost:3001`), `/v1` prefix, `{agentId}` rotate-key template, `/metrics` (not `/api/metrics`)
12. [ ] [Frontend API] New/modified API client function has test cases in a test file (CREATED or EXTENDED)
13. [ ] [Frontend UI] PhaseBlocked/PhaseInProgress feedback actions succeed end-to-end (F1)
14. [ ] [Frontend UI] ComputeNodes and ProjectMilestones pages load data (F2/F3)
15. [ ] [Both] F7: dev terminal WS connects through Vite proxy (`ws: true`); nginx forwards upgrade headers
16. [ ] [Both] OpenAPI spec is updated with JSDoc annotations (F2–F4)
17. [ ] [Both] Generated TypeScript types are regenerated and match (F6)
18. [ ] [Both] Bash integration suite passes (run `cd backend && bash integration-test/run.sh --only`) if backend API changed — regression tests for F2, F3, F4
19. [ ] [Both] Contract test (`api-contract.test.ts`) updated and passing if response shapes changed
20. [ ] [Both] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
21. [ ] [Both] All tests pass (unit, integration, frontend, lint, typecheck)
22. [ ] [Both] Specification in `04_SPECIFICATION.md` accurately reflects the implementation

---

## Out of Scope

- New UI components, pages, tabs, or navigation changes
- Backend behavior changes beyond the 7 findings (status transitions, permissions, auth)
- Removing the orphaned `ticketAttachment.js`/`ticketPlanning.js` router files (superseded by inline routes — cleanup only, no functional impact)
- Frontend refactors (e.g., migrating all raw client calls to generated services)
- Any database migrations (unless F1 design forces one — avoided by reusing `ticket_messages`)

---

## Performance Considerations

- Expected load: negligible — F1 adds one POST per human reply; F2–F5 restore existing endpoints
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A — F1 reuses the existing `ticket_messages` GET (`/tickets/:id/messages?limit=`); no new list endpoints

---

## Security Considerations

- [x] Authentication required: YES — all affected endpoints use `verifyToken` / `verifyTokenOrAgent` (F1 reuses existing `postMessage` auth; F2–F4 keep existing middleware)
- [x] Authorization check: YES — F4 fixes: `PROJECT_UPDATE` (environments), `TICKET_UPDATE` (deploy/rollback), `TICKET_STATUS_CHANGE` (status); F1 inherits `postMessage`'s existing permission-less behavior (pre-existing, accepted); F2/F3 keep existing middleware (verify codes exist in the 26-permission list)
- [x] Input validation: YES — F1 uses the existing `postMessage` body check (`messageType` and `content` required); F2–F4 already have validators
- [ ] Rate limiting: none new (matches existing comment/messages endpoints)
- [x] Sensitive data handling: N/A — feedback is plain text, no secrets

---

## Testing Checklist

### Test-First Requirement (if 04_SPECIFICATION.md exists)

- [ ] Empty test stub files created BEFORE any production code (listed as first file operations)
- [ ] Test stubs contain imports, `describe` blocks, and stub `it` blocks
- [ ] After implementation: test stubs filled in with actual assertions

### Backend Tests
- [x] Unit test files CREATED/EXTENDED for all changed code — F2–F4: extend `routeOrdering.test.js` with mount assertions; F4: extend permissions tests for the fixed deployments routes
- [x] Unit tests: `backend/src/__tests__/unit.test.js` — F4 permission middleware behavior on deployments routes (no backend change for F1)
- [x] Middleware tests: `backend/src/middleware/*.test.js` — only if permission middleware changes (not expected)
- [x] API endpoint tests: `backend/src/__tests__/api-*.test.js` — F4 route auth/403 assertions
- [ ] Jest integration tests: `backend/src/__tests__/integration/*.test.js` — F4 mounted routes lifecycle
- [ ] **Bash integration suite**: `backend/integration-test/suites/` — compute-nodes.test.sh (F2), milestones.test.sh (F3), deployments.test.sh (F4) — happy path, auth failure, permission denial
- [x] Every new controller method has at least one test case — N/A for F1 (no new backend code); F4 modified routes covered
- [x] Happy path AND error paths tested (not just happy path)
- [x] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### Frontend Tests
- [x] Unit test files CREATED/EXTENDED — F1: extend `PhaseBlocked`/`PhaseInProgress` component tests with the messages-endpoint URL/body assertions; F5: extend `client.test.ts` with URL assertions for planning usage helpers; F6: update `generatedTypesImport.test.ts`
- [x] API client tests: `frontend/src/__tests__/client.test.ts` — assert exact URLs
- [x] Component tests: `frontend/cypress/component/` — PhaseBlocked/PhaseInProgress feedback posts `{ messageType: 'feedback', content }` (CREATED or EXTENDED)
- [ ] E2E tests: `frontend/cypress/e2e/` — blocked-phase reply flow (optional, manual verify acceptable)
- [x] API contract tests: `frontend/src/__tests__/api-contract.test.ts` — messages endpoint already covered; add `message_type='feedback'` case if not present
- [x] Response validation: `frontend/src/api/validator.ts` — no new shapes (messages response already validated)
- [x] Every new API client function has at least one test case — N/A for F1 (existing `post()` used, component tests cover it)
- [x] Loading, error, and empty states tested — existing components unchanged

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run test:integration` — backend integration tests pass (if applicable)
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes (if applicable)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run --coverage` — frontend tests + coverage pass (60%)

---

## Anti-Patterns to Avoid

- ❌ **Adding a dedicated `/feedback` endpoint now** — decision is Option C (reuse `/messages`); Option A is deferred until the agent-side loop exists
- ❌ **Mounting the deployments router without fixing its auth bugs** — `PROJECT_ADMIN` is a role, not a permission code (permanent 403); three routes have no permission check
- ❌ **Hardcoding `/api/v1` into generated services** — fix the spec/BASE, regenerate, verify (F6)
- ❌ **Mounting routers without checking their permission codes exist** — verify against the 26-permission list (F2–F4)
- ❌ **Skipping regression tests** — every finding has a test that reproduces the original failure (404, wrong URL, WS timeout)
- ❌ **Changing verified-consistent endpoints** — only the 7 findings are in scope
- ❌ **Skipping the bash integration suite** — `backend/integration-test/run.sh --only` must pass for F2–F4
- ❌ **Ignoring coverage threshold** — CI enforces 60% min; run coverage locally before pushing

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
