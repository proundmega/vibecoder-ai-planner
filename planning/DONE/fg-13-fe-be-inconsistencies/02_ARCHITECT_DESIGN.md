# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Both
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

The frontend and backend API surfaces have drifted. Three UI features are completely broken (Compute Nodes, Milestones, blocked-phase feedback), one TicketDetail section fails silently (planning usage), the generated API client is stale and would break if adopted, and the terminal WebSocket cannot upgrade through either the dev or prod proxy. The fixes are small and mostly wiring-level, but each requires a regression test per the bug-fix protocol.

---

## Current State

### Existing Backend
- `backend/src/api/routes.js` → `/api` root (health/version/docs/metrics/auth/*) + `/v1` mount + csp-report + pool
- `backend/src/api/v1/index.js` → 17 sub-router mounts + inline templates/attachments/planning/planning-usage/ip-whitelist routes
- **Unmounted routers**: `compute-nodes.js`, `milestones.js`, `deployments.js` (and superseded `ticketAttachment.js`, `ticketPlanning.js`)
- Services exist and are functional: `DeployService.js`, `MilestoneService.js`, `ProvisioningService.js`, `PhaseService.js`, `HeartbeatService.js`
- `GET /api/v1/tickets/:ticketId/phases` family works (phase history/current/allowed/transition)
- No `feedback` route anywhere (`grep feedback backend/src` = 0 hits)

### Existing Frontend
- `frontend/src/api/client.ts` → `get/post/put/patch/del/postWithHeaders/postMultipart`; all use `/api/v1/...` EXCEPT `getTicketPlanningUsage` (line 208) and `getPlanningFileUsage` (line 240)
- `frontend/src/api/` modules: 20 files, all `/api/v1/`-prefixed
- `frontend/src/views/`: ComputeNodes.vue, ProjectMilestones.vue, PhaseFlow.vue (phases/PhaseBlocked.vue, phases/PhaseInProgress.vue), TicketDetail.vue (line 315 calls `getTicketPlanningUsage`), TerminalView.vue (line 32 WS URL)
- `frontend/src/api/generated/`: stale — `OpenAPI.ts` BASE `http://localhost:3001/api`, templates without `/v1`, `getApiMetrics` → `/api/api/metrics`, `postAgentsAgentIdRotateKey` → `/agents/:agentId/rotate-key`
- `frontend/vite.config.ts`: proxy `/api → http://localhost:3001`, **no `ws: true`**
- `frontend/nginx.conf`: `location /api/` proxies to backend, **no `Upgrade`/`Connection` headers**

### Gap Analysis
- F1: Frontend UI exists, backend endpoint missing → **FRONTEND-ONLY fix (Option C, user-approved 2026-08-06): retarget to existing `POST /tickets/:id/messages` with `messageType='feedback'`**
- F2/F3: Backend routers + services exist, mounting missing → BACKEND-ONLY
- F4: Backend router + services exist, mounting missing + **latent auth bugs to fix** → BACKEND-ONLY
- F5: Backend endpoint exists, frontend URL wrong → FRONTEND-ONLY
- F6: Backend spec exists, generated client stale → FRONTEND-ONLY (regenerate)
- F7: Both proxies missing WS config → CONFIG-ONLY
- Verified consistent (no change): auth shape, statuses, phases, 26 permissions, all other endpoint paths, usage/billing/memory response shapes

---

## Design

### F1 — Retarget feedback to the existing messages endpoint (Option C, user-approved)

No backend changes. The existing `POST /api/v1/tickets/:ticketId/messages` (route in `tickets.js`, `verifyTokenOrAgent`, handler `ticketController.postMessage` → `MessageService.postMessage`) already:
- accepts JWT users (`verifyTokenOrAgent` covers Bearer tokens),
- stores `message_type` as an **unconstrained VARCHAR** (`migration 011`: `message_type VARCHAR(50) NOT NULL DEFAULT 'update'`, no CHECK constraint) → `'feedback'` is storable without a migration,
- persists `{ ticket_id, user_id, message_type, content, metadata }` and returns 201 with the row.

Frontend changes (2 views, body gains `messageType`):

```
PhaseBlocked.vue:23  (Send Reply)
  post(`/api/v1/tickets/${props.ticketId}/feedback`, { content })          →  post(`/api/v1/tickets/${props.ticketId}/messages`, { messageType: 'feedback', content })

PhaseInProgress.vue:35 (Send Feedback)
  post(`/api/v1/tickets/${props.ticketId}/feedback`, { content })          →  post(`/api/v1/tickets/${props.ticketId}/messages`, { messageType: 'feedback', content })
```

Accepted trade-offs (documented for the record):
- `postMessage` has **no permission check** (any authenticated user can post any `message_type` — pre-existing behavior shared with agent message posting; adding `TICKET_COMMENT` here would break agents, out of scope)
- The agent never consumes feedback yet (`ApiService.getMessages` exists but has no Java callers; blocked phase is currently unreachable in production — `PhaseBlocked.vue`'s "Agent's Question" is hardcoded placeholder text)
- Follow-up: build the dedicated `/feedback` endpoint + agent blocked/feedback loop when the agent side is implemented (Pending Scope Items)

### F2/F3/F4 — Mount the existing routers (F4 includes auth-bug fixes)

`backend/src/api/v1/index.js` — add three mounts (before the catch-all; order vs `/projects`/`/tickets` mounts is irrelevant since paths don't collide):

```js
router.use('/compute-nodes', computeNodesRouter);   // GET/POST /, PUT/:id, DELETE/:id, POST/:id/test
router.use('/milestones', milestonesRouter);        // GET/POST /projects/:projectId/milestones, PUT/GET /milestones/:id, /progress, /tickets
router.use('/deployments', deploymentsRouter);      // GET/POST /projects/:projectId/environments, /environments/:id, /tickets/:ticketId/deploy, /deployments/:id/...
```

**F4 prerequisite — fix latent auth bugs in `deployments.js` BEFORE mounting** (discovered during audit):
1. `POST /projects/:projectId/environments` + `DELETE /environments/:id`: `requireAnyPermission('PROJECT_ADMIN')` → `requireAnyPermission('PROJECT_UPDATE')`. `PROJECT_ADMIN` is a **role name, not one of the 26 permission codes** (verified in `005_permission_system.sql`) → `hasAnyPermission` matches nothing → permanent 403 for everyone (no super_admin short-circuit in `PermissionService`).
2. `POST /tickets/:ticketId/deploy` + `POST /deployments/:id/rollback`: add `requireAnyPermission('TICKET_UPDATE')` (currently `verifyToken` + `validate` only → any authenticated user could trigger deploys/rollbacks).
3. `PATCH /deployments/:id/status`: add `requireAnyPermission('TICKET_STATUS_CHANGE')`. Verified safe: `DeployService.updateDeploymentStatus` is a direct DB update with **no external webhook receiver** — no non-JWT caller exists.

Permission choices mirror existing patterns: milestones/compute-nodes use `PROJECT_UPDATE` for writes; `triggerDeploy`/`rollback` gate on the ticket (`TICKET_UPDATE`); status transitions gate on `TICKET_STATUS_CHANGE` (same as `POST /tickets/:id/status`).

- Do NOT mount the superseded `ticketAttachment.js`/`ticketPlanning.js` (inline routes in `v1/index.js` already serve those paths)

### F5 — Fix the planning usage URLs

`frontend/src/api/client.ts`:
```ts
getTicketPlanningUsage: get(`/tickets/${ticketId}/planning/usage`)
  → get(`/api/v1/tickets/${ticketId}/planning/usage`)
getPlanningFileUsage: get(`/tickets/${ticketId}/planning/${encodeURIComponent(fileKey)}/usage`)
  → get(`/api/v1/tickets/${ticketId}/planning/${encodeURIComponent(fileKey)}/usage`)
```

No other changes — `TicketDetail.vue:315` keeps working unchanged.

### F6 — Fix the generated API client

1. Inspect `backend/src/api/openapi-spec.js` + `backend/src/api/openapi-generated.json` for the BASE URL and missing `/v1` (the spec probably documents paths WITHOUT the `/v1` prefix because `routes.js` mounts `/v1` at `router.use`, not in JSDoc paths)
2. Preferred: make JSDoc paths match the real mounted prefix OR set the generated `OpenAPI.BASE` to `/api/v1` (dev: Vite proxy handles it; prod: nginx) and remove `http://localhost:3001` hardcoding
3. `npm run generate:spec && npm run generate:api`, then verify:
   - `getApiMetrics` → `GET /api/metrics` (not `/api/api/metrics`)
   - `postAgentsAgentIdRotateKey` → `/agents/{agentId}/rotate-key`
   - All templates carry the `/v1` segment
4. Update `generatedTypesImport.test.ts` if signatures change

### F7 — Enable WebSocket proxying

`frontend/vite.config.ts`:
```ts
proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: true } }
```

`frontend/nginx.conf` (`location /api/`):
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Verified: Vite 5.4 only forwards `upgrade` events when `opts.ws` is truthy or the target is a `ws:` URL (checked in `node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js`). Without this, `TerminalView.vue` connections fail in dev. Nginx requires explicit upgrade headers in prod.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/api/v1/index.js` | MODIFY | Mount compute-nodes, milestones, deployments routers (F2/F3/F4) |
| `backend/src/api/deployments.js` | MODIFY | F4: `PROJECT_ADMIN` → `PROJECT_UPDATE` (2 routes); add `TICKET_UPDATE` (deploy, rollback) + `TICKET_STATUS_CHANGE` (status) + JSDoc |
| `frontend/src/views/phases/PhaseBlocked.vue` | MODIFY | F1: retarget POST to `/api/v1/tickets/:id/messages` with `messageType='feedback'` |
| `frontend/src/views/phases/PhaseInProgress.vue` | MODIFY | F1: retarget POST to `/api/v1/tickets/:id/messages` with `messageType='feedback'` |
| `frontend/src/api/client.ts` | MODIFY | F5: `/api/v1` prefix on two helpers |
| `frontend/src/api/generated/` | REGENERATE | F6: BASE, `/v1`, rotate-key, metrics |
| `frontend/vite.config.ts` | MODIFY | F7: `ws: true` |
| `frontend/nginx.conf` | MODIFY | F7: upgrade headers |
| `frontend/src/__tests__/client.test.ts` | EXTEND | F5: URL assertions |
| `backend/src/__tests__/routeOrdering.test.js` | EXTEND | F2–F4: mount assertions |
| `backend/integration-test/suites/deployments.test.sh` (new) | CREATE | F4: bash integration incl. permission denial |
| `frontend/cypress/component/` | EXTEND | F1: feedback posts `messageType='feedback'` |
| Migration `NNN_*.sql` | NONE | Verified not needed (`ticket_messages.message_type` unconstrained — migration 011) |

---

## Data Flow Diagram

```
F1 feedback (Option C):
[PhaseBlocked.vue | PhaseInProgress.vue] → [client.post] → [POST /api/v1/tickets/:id/messages]
  → [verifyTokenOrAgent] → [ticketController.postMessage] → [MessageService.postMessage]
  → [ticket_messages INSERT (message_type='feedback')] → [201 { success: true, data: message }]

F2–F4 (restored flow):
[ComputeNodes.vue / ProjectMilestones.vue / (future Deployments UI)]
  → [api/computeNodes.ts|milestones.ts|deployments.ts] → [/api/v1/compute-nodes|milestones|deployments|...]
  → [v1/index.js mount] → [router (F4: fixed permissions)] → [controller] → [service] → [DB]

F5:
[TicketDetail.vue:315] → [getTicketPlanningUsage] → [/api/v1/tickets/:id/planning/usage]
  → [v1/index.js inline route] → [aggregate SQL]

F7:
[TerminalView.vue] → [ws://host/api/terminal/:id?token=] → [Vite proxy ws:true | nginx upgrade headers]
  → [server.on('upgrade')] → [createTerminalWSS]
```

### Error Handling Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| F1 validation | Missing/empty messageType or content | 400 (existing `postMessage` check) |
| F1 auth | No/invalid token | 401 (existing `verifyTokenOrAgent`) |
| F1 not found | Ticket deleted/nonexistent | 404 (existing `MessageService`) |
| F4 permission (fixed) | Role lacks `PROJECT_UPDATE`/`TICKET_UPDATE`/`TICKET_STATUS_CHANGE` | 403 with `{ required, actualRole }` |
| F2–F4 | Router not mounted (today) | 404 catch-all → fixed by mounting; after fix, standard error handler |

---

## Dependencies

### Backend Dependencies
- `ticket_messages` table (exists, unconstrained `message_type`) — F1 storage via existing `MessageService.postMessage`
- `ProvisioningService`, `MilestoneService`, `DeployService` — already used by the unmounted routers
- `PermissionService` — F4 permission-code fix verified against the 26 seeded codes

### Frontend Dependencies
- `client.ts` get/post helpers — F1 (existing `post()`), F5
- `api/computeNodes.ts`, `api/milestones.ts`, `api/deployments.ts` — already call the to-be-mounted paths
- `generated/` regeneration pipeline (`npm run generate:spec && npm run generate:api`) — F6

### Cross-Cutting Dependencies
- OpenAPI JSDoc updates (F2–F4) → `openapi-generated.json` → generated types (F6)
- `validator.ts` / `api-contract.test.ts` — messages endpoint already covered (no F1 shape changes)

---

## Config / Environment Changes

- [ ] New environment variables: NONE
- [ ] New database migrations: NONE — verified: `ticket_messages.message_type` is `VARCHAR(50) NOT NULL DEFAULT 'update'` with no CHECK constraint (migration 011), so `message_type='feedback'` is storable as-is
- [ ] New npm dependencies: NONE
- [x] Existing config changes: `vite.config.ts` (`ws: true`), `nginx.conf` (upgrade headers)

---

## Database Changes

### New Tables
None.

### New Columns
None.

### Indexes
None.

### Migrations
- [ ] Migration `NNN_description.sql` — NONE (confirmed no CHECK constraint on `ticket_messages.message_type`)

---

## Security Considerations

- [x] New endpoints require authentication: F2–F4 existing `verifyToken`; F1 uses existing `verifyTokenOrAgent`
- [x] New endpoints require specific permissions: F4 adds `PROJECT_UPDATE` (environments), `TICKET_UPDATE` (deploy/rollback), `TICKET_STATUS_CHANGE` (status) — all verified present in the 26-permission list; F1 inherits `postMessage`'s existing (permission-less) behavior — accepted, documented
- [x] Input validated against: existing validators (`createEnvironmentSchema`, `triggerDeploySchema`, `updateDeploymentStatusSchema`, messages body check)
- [ ] Rate limiting: none new (matches comment/messages endpoints)
- [x] Sensitive data in responses: none new (webhook URLs are admin-visible, unchanged from service design)
- [x] SQL injection protection: parameterized queries everywhere (existing patterns)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/routeOrdering.test.js`, `api-*.test.js` | F2–F4: mounts return 200; F4: permission denial on fixed routes |
| Jest integration | Jest + real PG | `backend/src/__tests__/integration/*.test.js` | F4: mounted routes lifecycle + role-based access |
| **Bash integration** | curl | `backend/integration-test/suites/compute-nodes/milestones/deployments.test.sh` | F2–F4 real API, auth, 403 |
| Frontend unit | Vitest | `frontend/src/__tests__/client.test.ts` | F5 exact URL assertions |
| Component | Cypress | `frontend/cypress/component/` | F1: feedback posts `{ messageType: 'feedback', content }` |
| Generated types | Vitest | `frontend/src/__tests__/generatedTypesImport.test.ts` | F6 regen compile + rotate-key template |
| Contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | messages endpoint shape (already covered) |

### Frontend-Backend Contract Testing

- F1 adds no new response shapes (messages endpoint contract already covered)
- F6: generated types must compile with `npm run typecheck` after regen

---

## Risks and Edge Cases

### Backend Risks
- **[F4 permission fix]**: replacing `PROJECT_ADMIN` (role-as-code) with `PROJECT_UPDATE` is the correct fix, but any other unmounted router with role-as-code would 403 silently. **Mitigation**: grep all `requireAnyPermission` codes against the 26-permission list during mounting (milestones/compute-nodes verified OK).
- **[F4 deploy routes]**: adding `TICKET_UPDATE`/`TICKET_STATUS_CHANGE` changes auth semantics from "any auth'd user" to role-scoped — confirmed no other callers exist (no webhook receiver in `DeployService`), so no breakage.

### Frontend Risks
- **[F6 regen churn]**: regenerating generated services may rename functions breaking `generatedTypesImport.test.ts`. **Mitigation**: update the test; prod code doesn't import generated services.
- **[F5 relative URL]**: relative URLs resolve against the frontend origin — today they hit the SPA (dev) / index.html (prod). **Mitigation**: exact-URL unit assertions prevent regression.
- **[F1 body change]**: adding `messageType` to the POST body changes the request contract of two views — covered by component tests asserting URL + body.

### Integration Risks
- **[F7 dev vs prod]**: WS works differently through Vite vs nginx. **Mitigation**: verify dev via browser console; prod via `curl -i -H "Upgrade: websocket"` after deploy.

### Edge Cases
- [Empty/whitespace feedback]: existing `postMessage` 400 (`messageType and content are required`)
- [Feedback on deleted ticket]: existing `MessageService` 404
- [Blocked → feedback → unblock race]: two separate calls (POST message, then `phases/transition`) — no transaction needed; the UI already serializes via `transitioning` flag
- [F4 environment create with role-as-code bug]: pre-fix = 403 for everyone; post-fix = `project_admin` can create (regression test asserts this)

---

## Alternative Designs Considered

### Alternative 1: F1 — dedicated `POST /tickets/:id/feedback` endpoint (Option A)
- **Pros**: clean `TICKET_COMMENT` permission model; feedback visually distinct from agent messages; dedicated endpoint for the future agent blocked/feedback loop
- **Cons**: duplicates `MessageService.postMessage` (same table, same body minus `messageType`); ~5 files + tests for what one URL change achieves; no consumer until the agent side is built (agent never transitions to blocked, never reads feedback today)
- **Decision**: rejected — Option C chosen by user (2026-08-06). Revisit when the agent blocked/feedback loop is implemented.

### Alternative 2: F1 — remove the feedback UI entirely (Option B)
- **Pros**: zero changes; honest about current capabilities (blocked phase is unreachable in production)
- **Cons**: destroys the only human-input channel in the phase flow (`in_progress → blocked → in_progress` design); must be rebuilt later
- **Decision**: rejected — Option C chosen by user.

### Alternative 3: F4 — delete the unmounted deployments feature (Option B)
- **Pros**: less surface area; removes the latent auth bugs without fixing them
- **Cons**: destroys a designed, tested feature (validators + 149-line `DeployService` + 2 test files); re-build required if deployments are planned
- **Decision**: rejected — Option A chosen by user (mount + fix auth bugs).

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-100 | Per-file planning usage history exists in backend (`GET /tickets/:id/planning/:fileKey/usage`) but has no UI — `getPlanningFileUsage` (F5) is exported, never called | UX | bp-XX-planning-file-usage-ui | ☐ |
| 2 | bp-04 | `postWithHeaders` dead export (tests only) | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 3 | bp-80 | Superseded orphan routers (`ticketAttachment.js`, `ticketPlanning.js`) still on disk | Developer experience | bp-XX-dead-code-cleanup | ☐ |
| 4 | fg-06 | Generated services unused in production code (only types test) — consider deleting or adopting after F6 | Developer experience | (covered by F6) | ☐ |
| 5 | — | Route-mount drift (unmounted routers discovered by audit) → add a CI route-mount check | Developer experience | bp-XX-route-mount-audit | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file — NOT CREATED: both design decisions are now resolved (F1 = Option C, F4 = Option A); create if a small model will execute the ticket
- [ ] Test expectations are specific (not "test it works" but "returns 400 when content is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
