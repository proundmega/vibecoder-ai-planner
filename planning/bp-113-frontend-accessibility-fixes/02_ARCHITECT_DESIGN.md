# 02_ARCHITECT_DESIGN.md — Frontend Accessibility Fixes Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Four fully functional frontend views (ComputeNodes, ProjectMilestones, TerminalView, CspViolations) have no router routes, making them completely inaccessible to users. The auth store's `syncPermissions()` function has an early return bug that prevents full permission synchronization. The 404 handler redirects to /projects instead of showing a proper error page.

---

## Current State

### Existing Backend
All backend APIs already exist and are correctly mounted:
- `GET/POST/PUT/DELETE /api/v1/compute-nodes` — mounted in `backend/src/api/compute-nodes.js`
- `GET/POST/PUT/DELETE /milestones` — mounted in `backend/src/api/milestones.js`
- `GET/DELETE /api/v1/csp-violations` — mounted in `backend/src/api/routes.js`
- `WS /api/terminal/` — mounted in `backend/src/api/routes.js`

### Existing Frontend
- **API clients**: All exist in `frontend/src/api/` (computeNodes.ts, milestones.ts, cspViolations.ts)
- **Views**: All exist in `frontend/src/views/` (ComputeNodes.vue, ProjectMilestones.vue, TerminalView.vue, CspViolations.vue)
- **Tests**: All have existing tests (api-computeNodes.test.ts, cspViolations.test.ts, etc.)
- **Routes**: NONE of the 4 views have routes in `frontend/src/router/index.ts`
- **Auth store**: `syncPermissions()` in `auth.ts:115` has early `return` after first fresh permission fetch

### Gap Analysis
- Backend API: ✅ Complete
- Frontend API clients: ✅ Complete
- Frontend views: ✅ Complete
- Frontend tests: ✅ Complete
- **Frontend routes: ❌ MISSING (4 routes)**
- **Auth store sync: ❌ BUG (early return)**
- **404 page: ❌ MISSING (redirects to /projects)**

---

## Design

### Option A: Add Routes to Existing Router (Recommended)

Add 4 new route entries to `frontend/src/router/index.ts` following existing patterns.

**Pattern from existing routes:**
```typescript
{
  path: '/compute-nodes',
  name: 'ComputeNodes',
  component: () => import('../views/ComputeNodes.vue'),
  meta: { requiresAuth: true },
}
```

**Route structure:**
```
Top-level routes:
  /compute-nodes          → ComputeNodes.vue (requiresAuth)
  /terminal               → TerminalView.vue (requiresAuth)
  /csp-violations         → CspViolations.vue (requiresAuth)

Child routes of /projects/:id:
  /projects/:id/milestones → ProjectMilestones.vue (requiresAuth)

Error handling:
  /:pathMatch(.*)*        → ErrorPage.vue (new component, shows 404)
```

### Option B: Add to Existing Tab Structure

Not applicable — these are standalone pages, not project settings tabs.

### Option C: Create New Page

Not applicable — views already exist.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/router/index.ts` | MODIFY | Add 4 route entries (3 top-level, 1 child), change catch-all to render ErrorPage |
| `frontend/src/stores/auth.ts` | MODIFY | Fix `syncPermissions()` early return on line 115 |
| `frontend/src/views/ErrorPage.vue` | CREATE | New 404/500 error page component |
| `frontend/src/__tests__/errorPage.test.ts` | CREATE | Unit test for ErrorPage component |

---

## Data Flow Diagram

```
[User] → [Browser URL] → [Vue Router] → [View Component]
   ↑                                                    ↓
[404 Page] ← [Catch-all route] ← [Unknown path]
```

### Auth Store Fix Data Flow
```
[Login] → [setUser()] → [syncPermissions()] → [fetchPermissions()] → [setPermissions()]
                                                         ↓
                                                  (NO early return)
                                                  All expectedPerms checked
```

---

## Dependencies

### Frontend Dependencies
- `frontend/src/router/index.ts` — existing router with `createRouter`, `createWebHistory`
- `frontend/src/stores/auth.ts` — existing Pinia-like singleton store pattern
- `frontend/src/views/ComputeNodes.vue` — existing view, imports from `../api/computeNodes`
- `frontend/src/views/ProjectMilestones.vue` — existing view, imports from `../api/milestones`
- `frontend/src/views/TerminalView.vue` — existing view, uses WebSocket
- `frontend/src/views/CspViolations.vue` — existing view, imports from `../api/cspViolations`

---

## Config / Environment Changes

- No new environment variables
- No new database migrations
- No new npm dependencies

---

## Database Changes

None.

---

## Security Considerations

- All routes use existing `requiresAuth: true` meta — no new auth logic
- Terminal route: backend WS proxy already enforces `super_admin` role
- CSP violations: backend endpoint already requires `USER_VIEW_ALL` permission
- Compute nodes: backend routes already require `PROJECT_UPDATE` permission
- Milestones: backend routes already require `PROJECT_UPDATE` permission

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/errorPage.test.ts` | ErrorPage renders 404/500 correctly |
| Frontend unit | Vitest | `frontend/src/__tests__/` (existing) | Auth store syncPermissions fix |
| Frontend unit | Vitest | `frontend/src/__tests__/` (existing) | Router resolves all new paths |

### Frontend-Backend Contract Testing

No API changes — no contract tests needed.

---

## Risks and Edge Cases

### Frontend Risks
- **[Route conflict]**: If `/compute-nodes` or `/milestones` paths conflict with existing routes — **Mitigation**: check router/routes.js for path conflicts before adding
- **[Auth guard blocking]**: If `requiresAuth` guard blocks access for logged-in users — **Mitigation**: verify `isAuthenticated()` checks localStorage token, not auth store

### Edge Cases
- **No routes match**: User navigates to `/unknown/path` — should show ErrorPage.vue with 404 message
- **Auth store sync**: User with `project_admin` role should get all 20 permissions, not just the first batch

---

## Alternative Designs Considered

### Alternative 1: Add Navigation Links Now
- **Pros**: Users can discover the new pages immediately
- **Cons**: Out of scope, adds more files to change, increases PR size
- **Decision**: Deferred to follow-up ticket. Routes alone make pages accessible via direct URL.

### Alternative 2: Use Route-Level Permission Guards
- **Pros**: More granular access control at router level
- **Cons**: Existing pattern uses `requiredPermission` meta + router guard, but only for a few routes. Adding more would be inconsistent with the majority of routes that only use `requiresAuth`.
- **Decision**: Follow existing pattern — use `requiresAuth: true` only. Backend enforces permissions.

---

## Pending Scope Items to Present to User

**No deferred improvements found in previous tickets.**

---

## Specification Generation

This design is simple enough that `03_ARCHITECT_IMPLEMENTATION.md` will serve as the implementation guide. No `04_SPECIFICATION.md` needed.

---

*This design document guides implementation. The "Add Routes to Existing Router" section is the most important — it tells the agent exactly how to add routes rather than creating new code from scratch.*
