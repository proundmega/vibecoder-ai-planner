# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

## Ticket: fg-13 — Frontend/Backend API Surface Inconsistencies

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-08-06
**Date completed**:
**PR**:
**Branch**: `fix/fg-13-fe-be-inconsistencies`
**Scope**: Both

**Dependencies**: none (all 7 findings are independent; F6 depends on F2–F4 JSDoc for a complete spec)

---

### a) Purpose

Restore the frontend↔backend API surface consistency: 2 broken features (blocked-phase feedback, Compute Nodes/Milestones), 1 broken TicketDetail section (planning usage), a stale generated API client, and a non-functional terminal WebSocket proxy. Discovered by a full route-vs-client audit on 2026-08-06. **User decisions (2026-08-06)**: F1 = reuse the existing messages endpoint (Option C, frontend-only); F4 = mount the deployments router + fix its latent auth bugs (Option A).

---

### b) Actions

**CRITICAL**: All fixes extend existing code — no new pages, no new UI.

#### Implementation Order

1. **F2/F3/F4: Mount existing routers + fix F4 auth bugs** — `backend/src/api/v1/index.js`, `backend/src/api/deployments.js`
   - *Depends on*: nothing (pure wiring; unblocks F6 spec completeness)
2. **F1: Retarget feedback calls to messages endpoint** — `frontend/src/views/phases/PhaseBlocked.vue`, `frontend/src/views/phases/PhaseInProgress.vue`
   - *Depends on*: nothing (existing `POST /tickets/:id/messages` already serves JWT users)
3. **F5: Fix planning usage URLs** — `frontend/src/api/client.ts`
   - *Depends on*: nothing
4. **F7: Enable WS proxying** — `frontend/vite.config.ts`, `frontend/nginx.conf`
   - *Depends on*: nothing
5. **F6: Regenerate generated API client** — spec → `npm run generate:spec && npm run generate:api`
   - *Depends on*: F2–F4 (JSDoc completeness)
6. **Tests + verification** — regression tests for each finding, then full suites

#### Phase 1: Backend

1. Mount routers in `backend/src/api/v1/index.js` (F2/F3/F4):
   - `const computeNodesRouter = require('../compute-nodes');` → `router.use('/compute-nodes', computeNodesRouter);`
   - `const milestonesRouter = require('../milestones');` → `router.use('/milestones', milestonesRouter);`
   - `const deploymentsRouter = require('../deployments');` → `router.use('/deployments', deploymentsRouter);`
   - Verify paths: compute-nodes.js exposes `/`, `/:id`, `/:id/test`; milestones.js exposes `/projects/:projectId/milestones`, `/milestones/:id`, `/milestones/:id/progress`, `/milestones/:id/tickets`; deployments.js exposes `/projects/:projectId/environments`, `/environments/:id`, `/tickets/:ticketId/deploy`, `/deployments/:id/rollback`, `/deployments/:id/status`, `/tickets/:ticketId/deployments`
   - Verify every `requireAnyPermission` code exists in the 26-permission list before committing the mount

2. F4 auth-bug fixes in `backend/src/api/deployments.js` (BEFORE mounting is usable):
   - `POST /projects/:projectId/environments`: `requireAnyPermission('PROJECT_ADMIN')` → `requireAnyPermission('PROJECT_UPDATE')`
   - `DELETE /environments/:id`: `requireAnyPermission('PROJECT_ADMIN')` → `requireAnyPermission('PROJECT_UPDATE')`
   - `POST /tickets/:ticketId/deploy`: add `requireAnyPermission('TICKET_UPDATE')`
   - `POST /deployments/:id/rollback`: add `requireAnyPermission('TICKET_UPDATE')`
   - `PATCH /deployments/:id/status`: add `requireAnyPermission('TICKET_STATUS_CHANGE')`
   - Add `@openapi` JSDoc blocks for all 7 routes (missing today)
   - Rationale: `PROJECT_ADMIN` is a role name, not a permission code → permanent 403; the 3 unguarded routes were callable by any authenticated user

#### Phase 2: Frontend API Client

1. F5 — `frontend/src/api/client.ts` (MODIFY): prefix both helpers with `/api/v1`:
   - Line 208: `` get(`/tickets/${ticketId}/planning/usage`) `` → `` get(`/api/v1/tickets/${ticketId}/planning/usage`) ``
   - Line 240: `` get(`/tickets/${ticketId}/planning/${encodeURIComponent(fileKey)}/usage`) `` → `` get(`/api/v1/tickets/${ticketId}/planning/${encodeURIComponent(fileKey)}/usage`) ``

2. F1 — retarget the two phase views to the existing messages endpoint (body gains `messageType`):
   - `frontend/src/views/phases/PhaseBlocked.vue:23`: `` post(`/api/v1/tickets/${props.ticketId}/feedback`, { content }) `` → `` post(`/api/v1/tickets/${props.ticketId}/messages`, { messageType: 'feedback', content: replyText.value.trim() }) ``
   - `frontend/src/views/phases/PhaseInProgress.vue:35`: `` post(`/api/v1/tickets/${props.ticketId}/feedback`, { content }) `` → `` post(`/api/v1/tickets/${props.ticketId}/messages`, { messageType: 'feedback', content: feedbackText.value.trim() }) ``
   - No backend changes; `ticket_messages.message_type` accepts `'feedback'` (unconstrained VARCHAR, migration 011)

#### Phase 3: Frontend UI

No other UI changes. `TicketDetail.vue` (F5), `ComputeNodes.vue`/`ProjectMilestones.vue` (F2/F3) keep working unchanged once the backend/URLs are fixed.

#### Phase 4: Integration

1. F7 — `frontend/vite.config.ts` (MODIFY): add `ws: true` to the `/api` proxy entry
2. F7 — `frontend/nginx.conf` (MODIFY): add `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` to `location /api/`
3. F6 — OpenAPI/generated client:
   - Inspect `backend/src/api/openapi-spec.js` for the BASE URL and whether JSDoc paths include `/v1`
   - Fix `OpenAPI.BASE` to the proxied path (e.g. `/api/v1` or keep `/api` + add `/v1` in templates) — remove the hardcoded `http://localhost:3001`
   - Run `cd frontend && npm run generate:spec && npm run generate:api`
   - Verify: `getApiMetrics` no longer double-prefixes `/api`; `postAgentsAgentIdRotateKey` uses `{agentId}`; all templates include `/v1`
   - Run `npm run typecheck`
4. No `validator.ts`/`api-contract.test.ts` changes needed for F1 (messages endpoint contract already covered)

---

### c) Per-File Action Plan

#### `backend/src/api/v1/index.js` (MODIFY)
- **Add**: three `router.use(...)` mounts (compute-nodes, milestones, deployments) after the existing mounts block
- **Order**: before the inline ip-whitelist routes; no path collisions
- **Imports needed**: `require('../compute-nodes')`, `require('../milestones')`, `require('../deployments')`

#### `backend/src/api/deployments.js` (MODIFY, F4)
- **Change**: `requireAnyPermission('PROJECT_ADMIN')` → `requireAnyPermission('PROJECT_UPDATE')` on POST `/projects/:projectId/environments` and DELETE `/environments/:id` (role-as-code bug → permanent 403)
- **Add**: `requireAnyPermission('TICKET_UPDATE')` to POST `/tickets/:ticketId/deploy` and POST `/deployments/:id/rollback`; `requireAnyPermission('TICKET_STATUS_CHANGE')` to PATCH `/deployments/:id/status` (currently unguarded — any auth'd user)
- **Add**: `@openapi` JSDoc blocks for all 7 routes
- **Import**: `requireAnyPermission` already imported (line 4) — only usage changes

#### `frontend/src/views/phases/PhaseBlocked.vue` (MODIFY, F1)
- **Change**: `sendReply()` posts to `` `/api/v1/tickets/${props.ticketId}/messages` `` with `{ messageType: 'feedback', content: replyText.value.trim() }`
- **Position**: line 23 (`post(` call inside `sendReply()`)

#### `frontend/src/views/phases/PhaseInProgress.vue` (MODIFY, F1)
- **Change**: `sendFeedback()` posts to `` `/api/v1/tickets/${props.ticketId}/messages` `` with `{ messageType: 'feedback', content: feedbackText.value.trim() }`
- **Position**: line 35 (`post(` call inside `sendFeedback()`)

#### `frontend/src/api/client.ts` (MODIFY, F5)
- **Change**: two URL strings gain the `/api/v1` prefix (lines 208, 240)
- **Follow pattern**: identical to every other client module

#### `frontend/vite.config.ts` (MODIFY, F7)
- **Add**: `ws: true` to the `/api` proxy object

#### `frontend/nginx.conf` (MODIFY, F7)
- **Add**: Upgrade/Connection proxy_set_header lines in `location /api/`

#### `frontend/src/api/generated/` (REGENERATE, F6)
- Regenerate per Phase 4; update `generatedTypesImport.test.ts` for renamed/changed signatures

---

### d) Dependencies

- Existing `POST /tickets/:id/messages` + `MessageService.postMessage` + `ticket_messages` table (unconstrained `message_type`) — F1 (no new backend code)
- Existing unmounted routers + their services (`ProvisioningService`, `MilestoneService`, `DeployService`) — F2/F3/F4
- OpenAPI spec pipeline (`npm run generate:spec`, `npm run generate:api`) — F6
- `client.test.ts`, `routeOrdering.test.js`, cypress component tests — regression coverage
- Specification file: `04_SPECIFICATION.md` — NOT created; decisions resolved, create if a small model will execute the ticket

---

### e) Risks/Edge Cases

- **[F4 role-as-code]**: `PROJECT_ADMIN` used as a permission code → permanent 403; fixed to `PROJECT_UPDATE`. Grep other unmounted routers for the same pattern before mounting
- **[F4 unguarded deploy routes]**: no permission middleware → fixed with `TICKET_UPDATE`/`TICKET_STATUS_CHANGE`; verified no external webhook caller exists
- **[F6 regen breaks generatedTypesImport.test.ts]**: expected; update the test, prod code unaffected
- **[F1 messages endpoint permission gap]**: `postMessage` has no permission check (pre-existing, shared with agents) — accepted per user decision; out of scope
- **[F7 prod nginx]**: if WS still fails after headers, verify `proxy_read_timeout`/`proxy_send_timeout` are not killing idle sockets
- **[Empty/whitespace feedback]**: existing `postMessage` 400 (`messageType and content are required`)
- **[Feedback on nonexistent/deleted ticket]**: existing `MessageService` 404

---

### f) Testing

**MANDATORY: You MUST CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Test-First Requirement

`04_SPECIFICATION.md` will be created after user approval of the design decisions. If created, test stubs (with imports, `describe` blocks, stub `it` blocks) MUST be created before any production code.

#### Backend Unit Tests
- [ ] F2–F4: `backend/src/__tests__/routeOrdering.test.js` (EXTEND) — supertest GET `/api/v1/compute-nodes`, `/api/v1/projects/:id/milestones`, `/api/v1/tickets/:id/deployments` return 200/401 (not 404) after mounting
- [ ] F4: `backend/src/__tests__/api-deployments.test.js` (CREATE or EXTEND) — POST `/projects/:id/environments` as `project_admin` → 201 (regression: was permanent 403 due to `PROJECT_ADMIN` role-as-code); `user` role → 403; POST `/tickets/:id/deploy` as `user` → 403 (was 200 — regression); no token → 401
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — must pass 60% min

#### Backend Jest Integration Tests
- [ ] F4: mounted routes lifecycle — create environment (project_admin) → trigger deploy (TICKET_UPDATE) → update status (TICKET_STATUS_CHANGE); role-based access (401/403)

#### Backend Bash Integration Suite
- [ ] New: `backend/integration-test/suites/deployments.test.sh` — happy path (create env → deploy → status), auth failure, permission denial (`user` role 403); register in `run.sh` `main()`
- [ ] New (or extend existing): compute-nodes + milestones suites — GET list returns 200
- [ ] Suite runs cleanly: `cd backend && bash integration-test/run.sh --only`

#### Frontend Unit Tests
- [ ] F5: `frontend/src/__tests__/client.test.ts` (EXTEND) — assert `getTicketPlanningUsage(5)` calls `GET /api/v1/tickets/5/planning/usage` (exact URL); same for `getPlanningFileUsage` with encoded fileKey
- [ ] F1: component tests (EXTEND or CREATE) — `PhaseBlocked.vue` Send Reply and `PhaseInProgress.vue` Send Feedback post to `/api/v1/tickets/<id>/messages` with body `{ messageType: 'feedback', content }` (mock `post()` and assert URL + body; assert no call to `/feedback`)
- [ ] F6: `frontend/src/__tests__/generatedTypesImport.test.ts` (EXTEND) — regenerate passes typecheck; `getApiMetrics` path has single `/api`; rotate-key uses `{agentId}`

#### Frontend Contract Tests
- [ ] No `api-contract.test.ts` changes required for F1 (messages endpoint contract already covered; no new response shapes)
- [ ] Generated types compile: `npm run typecheck`

---

### g) Migration Notes (if applicable)

```sql
-- NO migration required.
-- Verified: ticket_messages.message_type is VARCHAR(50) NOT NULL DEFAULT 'update'
-- with NO CHECK constraint (migration 011), so message_type='feedback' is storable as-is.
```

- [ ] Migration file: NONE
- [ ] Rollback file: NONE

---

### h) Files Changed

**Backend:**
```
backend/src/api/v1/index.js                  → MODIFY (mount 3 routers)
backend/src/api/deployments.js               → MODIFY (F4 auth fixes + JSDoc)
backend/src/__tests__/routeOrdering.test.js  → EXTEND (F2–F4 mount assertions)
backend/src/__tests__/api-deployments.test.js → CREATE or EXTEND (F4 permission regression tests)
backend/integration-test/suites/deployments.test.sh → CREATE (F4 bash suite)
backend/integration-test/run.sh              → MODIFY (register new suite)
```

**Frontend:**
```
frontend/src/views/phases/PhaseBlocked.vue     → MODIFY (F1 retarget to messages endpoint)
frontend/src/views/phases/PhaseInProgress.vue  → MODIFY (F1 retarget to messages endpoint)
frontend/src/api/client.ts                     → MODIFY (F5 /api/v1 prefix)
frontend/vite.config.ts                        → MODIFY (F7 ws: true)
frontend/nginx.conf                            → MODIFY (F7 upgrade headers)
frontend/src/api/generated/                    → REGENERATE (F6)
frontend/src/__tests__/client.test.ts          → EXTEND (F5 URL assertions)
frontend/src/__tests__/generatedTypesImport.test.ts → EXTEND (F6)
frontend/cypress/component/ (phase flow)       → EXTEND (F1 feedback URL/body assertions)
```

**NOT changed (user decisions):** no `feedback` endpoint, no new validators, no `TicketService`/`ticketController`/`tickets.js` changes, no `validator.ts`/`api-contract.test.ts` F1 changes; `frontend/src/api/deployments.ts` stays dormant.

**Unchanged (verified consistent):** all other endpoints, auth contract, statuses, phases, permissions, response shapes.

---

### Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-100 | Per-file planning usage has no UI (`getPlanningFileUsage` unused) | UX | bp-XX-planning-file-usage-ui | ☐ |
| 2 | bp-04 | `postWithHeaders` dead export | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 3 | bp-80 | Orphaned `ticketAttachment.js`/`ticketPlanning.js` routers on disk | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 4 | fg-06 | Generated services unused in production | Developer experience | (covered by F6) | ☐ |
| 5 | — | CI route-mount drift check (audit found unmounted routers) | Developer experience | bp-XX-route-mount-audit | ☐ |

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations (F2–F4)
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] Regression test added for EACH finding (F1–F7), reproducing the original failure
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes (F2–F4)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes (if applicable)
3. [ ] **Backend: `cd backend && bash integration-test/run.sh --only` passes (if backend API changed)**
4. [ ] Backend: `npm run lint` passes
5. [ ] **Backend: `npm run test:coverage` passes (60% min threshold)**
6. [ ] Frontend: `npm run lint` passes
7. [ ] Frontend: `npm run typecheck` passes
8. [ ] Frontend: `npm run build` passes
9. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
10. [ ] `curl http://localhost:3001/api/v1/compute-nodes` returns 200 (not 404)
11. [ ] `curl http://localhost:3001/api/v1/projects/<id>/milestones` returns 200 (not 404)
 12. [ ] `curl -X POST http://localhost:3001/api/v1/tickets/<id>/messages` with token + `{ messageType: 'feedback', content }` returns 201 (F1 — messages endpoint)
 13. [ ] `curl -X POST http://localhost:3001/api/v1/projects/<id>/environments` as `project_admin` returns 201 (F4 — was permanent 403); as `user` returns 403
 14. [ ] TicketDetail planning usage section renders real numbers
 15. [ ] PhaseBlocked "Send Reply" succeeds and appears in feedback list
 16. [ ] Terminal WS connects in dev (browser console) and through nginx (prod)
 17. [ ] Generated types compile; `getApiMetrics`/rotate-key templates correct

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
