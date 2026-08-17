# bp-115: Route-Level Permission Guards

## Ticket Information
- **ID**: bp-115
- **Priority**: P1 (security — routes accessible without proper authorization)
- **Type**: Security Hardening
- **Scope**: Frontend + Backend

## Problem Statement

The 4 routes added in bp-113 (compute-nodes, milestones, terminal, csp-violations) only have `requiresAuth: true` in their router meta. They lack `requiredPermission` guards, meaning any authenticated user can access them regardless of their role/permissions. The backend API endpoints have permission checks, but the frontend router silently redirects unauthorized users to Dashboard without explanation.

### Current State

| Route | Frontend Guard | Backend Guard | Gap |
|-------|---------------|---------------|-----|
| `/compute-nodes` | `requiresAuth: true` | `PROJECT_UPDATE` | ✅ Frontend needs guard |
| `/projects/:id/milestones` | `requiresAuth: true` | Read: none, Write: `PROJECT_UPDATE` | ⚠️ Read has no guard (acceptable) |
| `/terminal/:id` | `requiresAuth: true` | `super_admin` (hard-coded) | ✅ Frontend needs guard |
| `/csp-violations` | `requiresAuth: true` | **None** (verifyToken only) | ❌ Both frontend and backend need guards |

### Critical Gap: CSP Violations

The CSP violations endpoint (`GET /api/v1/csp-violations` and `DELETE /api/v1/csp-violations`) has **no permission check** beyond `verifyToken`. This contradicts the bp-113 design doc which claimed it requires `USER_VIEW_ALL`. Any authenticated user can view and delete CSP violations.

## Solution

### 1. Add CSP_READ permission (backend)

Add `CSP_READ` (code 27) and `CSP_DELETE` (code 28) to the permission catalog:
- `CSP_READ`: View CSP violations (granted to project_admin, super_admin)
- `CSP_DELETE`: Delete CSP violations (granted to super_admin only)

### 2. Add permission guards to CSP violations backend endpoints

- `GET /api/v1/csp-violations`: Add `requireAnyPermission('CSP_READ')`
- `DELETE /api/v1/csp-violations`: Add `requireAnyPermission('CSP_DELETE')`

### 3. Add requiredPermission to frontend routes

| Route | requiredPermission | Rationale |
|-------|-------------------|-----------|
| `/compute-nodes` | `PROJECT_UPDATE` | Matches backend, visible to project_admin+ |
| `/projects/:id/milestones` | (none) | Read has no backend guard; inherit from parent |
| `/terminal/:id` | (none) | Server enforces super_admin at WebSocket level |
| `/csp-violations` | `CSP_READ` | New permission, matches intended access |

### 4. Update App.vue nav link guards

- Compute Nodes: `isProjectAdmin() || isSuperAdmin()` → `hasAnyPermission(['PROJECT_UPDATE'])`
- CSP Violations: `isProjectAdmin() || isSuperAdmin()` → `hasAnyPermission(['CSP_READ'])`

## Files to Change

| File | Changes |
|------|---------|
| `backend/src/migrations/042_csp_permissions.sql` | NEW — Add CSP_READ, CSP_DELETE permissions + role assignments |
| `backend/src/api/csp-violations.js` | Add requireAnyPermission guards |
| `frontend/src/router/index.ts` | Add requiredPermission to routes |
| `frontend/src/App.vue` | Update nav link guards |
| `backend/src/__tests__/cspViolationsPermissions.test.js` | NEW — Permission guard tests |

## Testing

- Backend: supertest tests for 403 on unauthorized access to CSP endpoints
- Frontend: router guard tests for permission-based navigation
- Permission migration: verify role assignments in test DB

## Out of Scope

- Adding a dedicated 403 error page (current behavior: silent redirect to Dashboard)
- Role-based nav link visibility for terminal (no nav link, accessible via direct URL)
- Permission audit for all other routes (future comprehensive audit)

## Deferred Improvements Found

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-112 | Java agent unit tests | Testing | bp-118-java-agent-unit-tests |
| 2 | bp-113 | Planning file usage UI (per-file history) | UX | bp-116-planning-file-usage-ui |
| 3 | bp-113 | Cypress E2E tests for new routes | Testing | (deferred) |
| 4 | fg-13 | Route mount audit script | Developer experience | bp-117-route-mount-audit |
| 5 | bp-99 | Runtime provider config hot reload | Feature | bp-119-provider-config-hot-reload |
