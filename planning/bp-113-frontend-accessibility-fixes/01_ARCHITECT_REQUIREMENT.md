# 01_ARCHITECT_REQUIREMENT.md — Frontend Accessibility Fixes

**Status**: planned
**Date created**: 2025-08-08
**Date completed**:
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Small

---

## Requirement

Several frontend view components exist with full UI, API clients, and tests but are inaccessible because they have no routes in the Vue Router. Additionally, the auth store has a bug that prevents full permission synchronization, and the 404 handling redirects to /projects instead of showing a proper page.

This ticket makes all existing frontend views accessible and fixes the auth store permission sync bug.

---

## Existing Infrastructure Audit

### Backend API Check
- **ComputeNodes**: Backend routes exist at `/api/v1/compute-nodes/*` (mounted in `backend/src/api/compute-nodes.js`, line 11-52) — ✅ YES
- **ProjectMilestones**: Backend routes exist at `/api/v1/milestones/*` (mounted in `backend/src/api/milestones.js`, line 16-23) — ✅ YES
- **Terminal**: Backend route exists at `/api/terminal/` (WebSocket proxy, line 240-256 in `backend/src/api/routes.js`) — ✅ YES
- **CspViolations**: Backend routes exist at `/api/v1/csp-violations/*` (mounted in `backend/src/api/routes.js`, line 149-172) — ✅ YES

### Frontend API Client Check
- **ComputeNodes**: `frontend/src/api/computeNodes.ts` exists with `listComputeNodes`, `createComputeNode`, `updateComputeNode`, `deleteComputeNode`, `testComputeNodeConnection`, `getRunningContainers` — ✅ YES
- **ProjectMilestones**: `frontend/src/api/milestones.ts` exists with `listMilestones`, `createMilestone`, `updateMilestone`, `deleteMilestone` — ✅ YES
- **Terminal**: WebSocket handled via `ws://` direct connection (no API client needed) — ✅ YES
- **CspViolations**: `frontend/src/api/cspViolations.ts` exists with `getCspViolations`, `clearCspViolations`, `CspViolation` type — ✅ YES

### Frontend UI Check
- **ComputeNodes**: `frontend/src/views/ComputeNodes.vue` (338 lines) — ✅ EXISTS, full UI with node list, create/edit modal, test button, status badges
- **ProjectMilestones**: `frontend/src/views/ProjectMilestones.vue` (6548 bytes) — ✅ EXISTS, milestone management UI
- **TerminalView**: `frontend/src/views/TerminalView.vue` (2623 bytes) — ✅ EXISTS, simple terminal proxy view
- **CspViolations**: `frontend/src/views/CspViolations.vue` (5684 bytes) — ✅ EXISTS, CSP violation viewer with pagination

### Route Check
- **ComputeNodes**: No route in `frontend/src/router/index.ts` — ❌ MISSING
- **ProjectMilestones**: No route in `frontend/src/router/index.ts` — ❌ MISSING
- **TerminalView**: No route in `frontend/src/router/index.ts` — ❌ MISSING
- **CspViolations**: No route in `frontend/src/router/index.ts` — ❌ MISSING

### Integration Check
- All API clients already call the correct backend endpoints — ✅ YES
- All views already use their respective API clients — ✅ YES
- Auth tokens already handled by `apiFetch` in `client.ts` — ✅ YES

### Key Insight

**FRONTEND-ONLY task.** All backend APIs, frontend API clients, and frontend views already exist with full functionality and tests. The only missing piece is Vue Router routes. This is a 4-line change per view plus auth store fix.

---

## Scope

### In Scope
- Add route for `/compute-nodes` → `ComputeNodes.vue` (super_admin only, requires `PROJECT_UPDATE` permission)
- Add route for `/projects/:id/milestones` → `ProjectMilestones.vue` (child route of ProjectDetail)
- Add route for `/terminal` → `TerminalView.vue` (super_admin only)
- Add route for `/csp-violations` → `CspViolations.vue` (super_admin only)
- Fix `auth.ts` `syncPermissions()` early return bug (line 115)
- Add proper 404 page instead of redirecting to /projects

### Out of Scope
- Backend route changes (all routes already exist)
- New API clients (all already exist)
- New view components (all already exist)
- Cypress E2E tests for new routes
- Navigation menu updates (deferred to a follow-up ticket)

---

## Pending Scope Items to Present to User

**No deferred improvements found in previous tickets relevant to frontend routing or auth store.**

---

## Deferred Improvements Found (Internal Tracking)

**No deferred improvements found in previous tickets.**

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/router/index.ts` | MODIFY | Add 4 routes (2 top-level, 2 child routes) |
| `frontend/src/stores/auth.ts` | MODIFY | Fix `syncPermissions()` early return bug |
| `frontend/src/views/ErrorPage.vue` | CREATE | New 404/500 error page component |
| `frontend/src/router/index.ts` | MODIFY | Add catch-all route to ErrorPage instead of redirecting to /projects |

---

## Known Unknowns

1. **Terminal route auth**: The terminal WS proxy requires `super_admin` role and token via URL param. Should the route require `super_admin` role check in the router guard? — Assumption: YES, add `requiredPermission: 'USER_VIEW_ALL'` (super_admin bypass)
2. **ProjectMilestones parent route**: Should milestones be a child route of `/projects/:id` (like tickets, github, ai) or a sibling? — Assumption: child route under `/projects/:id/milestones` to match backend route pattern `/milestones/projects/:projectId/...`

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] `GET /compute-nodes` renders `ComputeNodes.vue` for authenticated users
2. [ ] `GET /projects/:id/milestones` renders `ProjectMilestones.vue` as a child route
3. [ ] `GET /terminal` renders `TerminalView.vue` for authenticated users
4. [ ] `GET /csp-violations` renders `CspViolations.vue` for authenticated users
5. [ ] `syncPermissions()` in auth.ts fully syncs all expected permissions (no early return)
6. [ ] Unknown routes render ErrorPage.vue instead of redirecting to /projects
7. [ ] All existing tests still pass (`npm test -- --run`)
8. [ ] Frontend typecheck passes (`npm run typecheck`)
9. [ ] Frontend lint passes (`npm run lint`)

---

## Out of Scope

- Navigation menu/sidebar links to these new routes (deferred to a follow-up ticket)
- Route-level permission guards beyond existing `requiresAuth` (deferred)
- Cypress E2E tests for new routes (deferred)
- Opening new routes in a new browser window/tab

---

## Performance Considerations

- All views use dynamic imports (`() => import(...)`) for lazy loading — no bundle impact
- No new API calls on route change beyond what each component already makes on mount

---

## Security Considerations

- Terminal route: existing WS proxy already enforces `super_admin` role in backend middleware
- CSP violations route: existing backend endpoint requires `USER_VIEW_ALL` permission
- Compute nodes route: existing backend routes require `PROJECT_UPDATE` permission
- All routes use existing `requiresAuth` guard — no new auth logic needed

---

## Testing Checklist

### Frontend Tests
- [ ] Unit test for new ErrorPage.vue component — CREATED
- [ ] Router test verifying all 4 new routes resolve to correct components — EXTENDED (if router tests exist) or CREATED
- [ ] Auth store `syncPermissions()` test verifying no early return — EXTENDED auth.ts tests
- [ ] All existing tests still pass: `npm test -- --run`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Lint passes: `npm run lint`

### CI Requirements
- [ ] `npm test -- --run` — frontend unit tests pass
- [ ] `npm run typecheck` — no type errors
- [ ] `npm run lint` — no lint errors
- [ ] `npm run build` — production build passes

---

## Anti-Patterns to Avoid

- ❌ **Creating new API clients** — all already exist
- ❌ **Creating new view components** — all already exist
- ❌ **Duplicating route patterns** — follow existing patterns from `router/index.ts`
- ❌ **Adding navigation links** — out of scope, deferred
- ❌ **Changing backend routes** — all already exist
- ❌ **Adding new dependencies** — no new packages needed

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
