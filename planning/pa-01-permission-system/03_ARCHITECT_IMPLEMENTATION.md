# 03_ARCHITECT_IMPLEMENTATION.md — Permission System Implementation

**Ticket**: PA-01 — Permission-Based Access Control System
**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: Lead Architect
**Date created**: 2026-06-07
**Branch**: `feature/permission-system`

**Dependencies**:
- RS-01 (DB Migration) — existing users table schema
- RS-03 (Auth Middleware) — `req.user` structure must be available

---

### a) Purpose

Replace scattered role-based access checks (`role === 'project_admin'`, `includes(['admin', 'member'])`) with a permission-based system where roles are mapped to granular permissions in the database. This eliminates the need to update dozens of files when adding or modifying roles, makes screen testing easier (assign permissions, not accounts), and provides a single source of truth for access control.

---

### b) Actions

#### Step 1: Database Migration — Create Permission Tables

**File**: `backend/src/migrations/005_permission_system.sql`

Create three new tables (`permissions`, `roles`, `role_permissions`) and seed them with data derived from existing roles.

**Actions**:
1. Create `permissions` table with 26 permission codes (see design doc)
2. Create `roles` table with 4 roles matching existing `users.role` values
3. Create `role_permissions` junction table with proper indexes
4. Seed data:
   - `super_admin` → all 26 permissions
   - `project_admin` → 17 permissions (no `USER_DELETE`, `USER_TOGGLE_ACTIVE`, `USER_VIEW_ALL`, `AGENT_REVOKE`)
   - `member` → 11 permissions (no user management beyond `USER_CREATE`)
   - `user` → 8 permissions (create/update own tickets, read-only)
5. Add migration entry to `apply.js`

**Verify**:
```bash
# After migration, run:
psql -d vibecode -c "SELECT r.name, COUNT(rp.permission_id) as perm_count FROM roles r LEFT JOIN role_permissions rp ON r.id = rp.role_id GROUP BY r.name ORDER BY r.name;"
# Expected: super_admin=26, project_admin=17, member=11, user=8
```

---

#### Step 2: Backend — Permission Service

**File**: `backend/src/services/PermissionService.js` (new)

**Actions**:
1. Create `PermissionService.js` with:
   - `resolvePermissions(roleName)` — returns `Set<string>` of permission codes
   - `hasPermission(roleName, code)` — boolean check
   - `hasAnyPermission(roleName, codes)` — OR check
   - `hasAllPermissions(roleName, codes)` — AND check
   - `clearCache()` — clear in-memory cache
2. Cache role-permission mappings in a `Map` (keyed by role name)
3. Single SQL query with JOINs to resolve permissions

**Unit Tests**: `backend/src/__tests__/unit/permissionService.test.js`
- `resolvePermissions('super_admin')` returns all 26 permissions
- `resolvePermissions('user')` returns 8 permissions
- `hasPermission('project_admin', 'USER_DELETE')` returns false
- `hasPermission('project_admin', 'TICKET_CREATE')` returns true
- `hasAnyPermission('user', ['USER_DELETE', 'TICKET_CREATE'])` returns true (TICKET_CREATE)
- `hasAllPermissions('user', ['USER_DELETE', 'TICKET_CREATE'])` returns false
- `clearCache()` clears the in-memory cache
- Cached results are returned without DB call on second lookup

---

#### Step 3: Backend — Permission Middleware

**File**: `backend/src/middleware/permissions.js` (rewrite existing unused file)

**Actions**:
1. Rewrite to use `PermissionService` instead of inline role checks
2. Export `requireAnyPermission(...codes)` — OR logic
3. Export `requireAllPermissions(...codes)` — AND logic
4. Both return Express middleware functions
5. Handle unauthenticated users (401) and unauthorized users (403)

**Unit Tests**: `backend/src/middleware/permissions.test.js`
- `requireAnyPermission('TICKET_CREATE')` allows user with TICKET_CREATE
- `requireAnyPermission('TICKET_CREATE')` rejects user without TICKET_CREATE
- `requireAllPermissions('A', 'B')` requires both permissions
- Unauthenticated request returns 401

---

#### Step 4: Backend — Permissions API Endpoint

**File**: `backend/src/api/permissions.js` (new)
**Mount**: `backend/src/api/routes.js` → `router.use('/permissions', permissionsRouter)`

**Actions**:
1. Create `GET /api/permissions/:roleName` endpoint
2. Returns `{ success: true, data: [permissionCodes] }`
3. Used by frontend to resolve permissions for logged-in user's role

**Integration Tests**: `backend/src/__tests__/integration/api-permissions.test.js`
- GET `/api/permissions/super_admin` returns all 26 codes
- GET `/api/permissions/user` returns 8 codes
- GET `/api/permissions/nonexistent` returns 404

---

#### Step 5: Backend — Route Migration (Replace `requireRole` with Permission Middleware)

**Files to change** (11 route definitions across 5 files):

| File | Route | Old Guard | New Guard |
|------|-------|-----------|-----------|
| `api/users.js:12` | `POST /api/users` | `requireRole('project_admin', 'member')` | `requireAnyPermission('USER_CREATE')` |
| `api/users.js:19` | `PATCH /toggle-active` | `requireRole('project_admin', 'super_admin')` | `requireAnyPermission('USER_TOGGLE_ACTIVE')` |
| `api/users.js:22` | `DELETE /api/users/:id` | `requireRole('project_admin', 'super_admin')` | `requireAnyPermission('USER_DELETE')` |
| `api/users.js:25` | `GET /super-admin` | `requireRole('super_admin')` | `requireAnyPermission('USER_VIEW_ALL')` |
| `api/projects.js:42` | `DELETE /tickets/:id` | `requireRole('project_admin', 'member', 'user')` | `requireAnyPermission('TICKET_DELETE')` |
| `api/tickets.js:18` | `DELETE /tickets/:id` | `requireRole('project_admin', 'member')` | `requireAnyPermission('TICKET_DELETE')` |
| `api/agents.js:17` | `POST /agents/create` | `requireRole('project_admin', 'member')` | `requireAnyPermission('AGENT_CREATE')` |
| `api/agents.js:48` | `POST /agents/revoke/:id` | `requireRole('project_admin')` | `requireAnyPermission('AGENT_REVOKE')` |
| `api/agents.js:59` | `DELETE /agents/:id` | `requireRole('project_admin')` | `requireAnyPermission('AGENT_DELETE')` |
| `api/approvals.js:46` | `POST /:id/approve` | `requireRole('project_admin', 'member', 'super_admin')` | `requireAnyPermission('APPROVAL_APPROVE')` |
| `api/approvals.js:64` | `POST /:id/reject` | `requireRole('project_admin', 'member', 'super_admin')` | `requireAnyPermission('APPROVAL_REJECT')` |
| `api/approvals.js:82` | `GET /api/approvals` | `requireRole('super_admin')` | `requireAnyPermission('APPROVAL_VIEW')` |

**Actions**:
1. Replace each `requireRole(...)` call with the appropriate permission middleware
2. Import `requireAnyPermission` from `./permissions` middleware
3. Keep old `requireRole` middleware in place (don't delete — may still be used elsewhere)
4. Update route tests to verify permission-based access

**Unit Tests** (per route file):
- Each route test verifies that a user WITHOUT the required permission gets 403
- Each route test verifies that a user WITH the required permission gets 200

---

#### Step 6: Backend — Service-Level Permission Checks

**Files to change**:

**`services/TicketService.js`** (update + delete methods):
```javascript
// Before:
if (user.role !== 'super_admin' && user.role !== 'project_admin' && user.role !== 'member' && ticket.ownerId !== userId) {
  throw new ForbiddenError('Unauthorized to edit this ticket');
}

// After:
const canUpdate = await PermissionService.hasPermission(user.role, 'TICKET_UPDATE');
if (!canUpdate && ticket.ownerId !== userId) {
  throw new ForbiddenError('Unauthorized to edit this ticket');
}
```

**`services/UserService.js`** (createUser role hierarchy):
```javascript
// Before:
if (creator.role === 'project_admin') {
  if (!['member', 'user'].includes(role)) throw ...
} else if (creator.role === 'member') {
  if (role !== 'user') throw ...
}

// After:
const canCreateRole = await PermissionService.hasPermission(creator.role, 'USER_CREATE');
if (!canCreateRole) throw new ForbiddenError('Insufficient permissions to create users');
// Role hierarchy still enforced: project_admin can create member+user, member can create user only
// This business logic stays — permissions control WHO can create, hierarchy controls WHAT role they can create
```

**`services/UserService.js`** (listUsers filtering):
```javascript
// Before:
if (userRole === 'project_admin') { ... }
else if (userRole === 'member') { ... }

// After:
const canViewAll = await PermissionService.hasPermission(userRole, 'USER_VIEW_ALL');
if (!canViewAll) {
  // Apply scoped filtering (same logic, just uses permission check as gate)
}
```

**`services/ApprovalService.js`** (approve/reject):
```javascript
// Before:
if (!['project_admin', 'member', 'super_admin'].includes(approvedUser.role)) {
  throw new ForbiddenError('...');
}

// After:
const canApprove = await PermissionService.hasPermission(approvedUser.role, 'APPROVAL_APPROVE');
if (!canApprove) {
  throw new ForbiddenError('...');
}
```

**`controllers/ticketController.js`** (update + status change):
```javascript
// Before:
if (user.role === 'user' && ticket.owner_id !== req.user.userId) {
  return res.status(403).json({ error: 'AI agents can only update their own tickets' });
}

// After:
const canUpdate = await PermissionService.hasPermission(user.role, 'TICKET_UPDATE');
if (!canUpdate && ticket.owner_id !== req.user.userId) {
  return res.status(403).json({ error: 'AI agents can only update their own tickets' });
}
```

**Unit Tests**:
- `TicketService.update()` — permission check rejects unauthorized roles
- `TicketService.delete()` — permission check rejects unauthorized roles
- `UserService.createUser()` — permission check rejects unauthorized creators
- `ApprovalService.approve()` — permission check rejects unauthorized approvers

---

#### Step 7: Frontend — Auth Store Extension

**File**: `frontend/src/stores/auth.js`

**Actions**:
1. Add `rolePermissions: ref(new Set())` reactive state
2. Add `hasPermission(permissionCode)` — checks if permission is in the set
3. Add `hasAnyPermission(permissionCodes)` — OR check
4. Add `loadRolePermissions()` — fetches from `GET /api/permissions/:role` on login
5. Call `loadRolePermissions()` in login flow and after token refresh
6. Keep existing role-based helpers (`isProjectAdmin`, etc.) for backward compatibility (deprecated)

**Unit Tests**: `frontend/src/__tests__/authStore.test.ts`
- `hasPermission('TICKET_CREATE')` returns true for project_admin
- `hasPermission('USER_DELETE')` returns false for member
- `hasAnyPermission(['USER_DELETE', 'TICKET_CREATE'])` returns true for member (has TICKET_CREATE)

---

#### Step 8: Frontend — Component Migration

**Files to change** (replace role checks with permission checks):

| File | Line | Before | After |
|------|------|--------|-------|
| `TicketBoard.vue` | 40 | `['project_admin', 'member', 'user', 'super_admin'].includes(role)` | `hasPermission('TICKET_CREATE')` |
| `TicketBoard.vue` | 87 | `['project_admin', 'member', 'super_admin'].includes(role)` | `hasPermission('TICKET_UPDATE')` |
| `TicketDetail.vue` | 39 | `['project_admin', 'member', 'super_admin'].includes(role)` | `hasPermission('TICKET_UPDATE')` |
| `TicketDetail.vue` | 47 | `['project_admin', 'member', 'super_admin'].includes(role)` | `hasPermission('TICKET_DELETE')` |
| `UserManagement.vue` | 19 | `role === 'project_admin' \|\| role === 'member'` | `hasPermission('USER_CREATE')` |
| `UserManagement.vue` | 24 | `role === 'project_admin' \|\| role === 'super_admin'` | `hasPermission('USER_DELETE')` |
| `UserManagement.vue` | 29 | `role === 'project_admin' \|\| role === 'super_admin'` | `hasPermission('USER_TOGGLE_ACTIVE')` |
| `SuperAdminUsers.vue` | template | `user.role !== 'super_admin'` | `!hasPermission('USER_VIEW_ALL')` |
| `TicketEditModal.vue` | 25 | `['project_admin', 'member'].includes(role)` | `hasPermission('TICKET_UPDATE')` |
| `UserModal.vue` | 22, 27 | `role === 'project_admin' \|\| role === 'ADMIN'` | `hasPermission('USER_CREATE')` |
| `App.vue` | 42 | `['project_admin', 'member', 'super_admin'].includes(role)` | `hasPermission('USER_READ')` |
| `App.vue` | 48 | `role === 'super_admin'` | `hasPermission('USER_VIEW_ALL')` |
| `router/index.ts` | 100 | `allowedRoles.includes(userRole)` | `hasAnyPermission(allowedPermissions)` |

**Note**: Router guards need special handling — they run before the auth store is populated with permissions. Solution: map route `allowedRoles` to `allowedPermissions` in route meta, or fetch permissions early in the navigation guard.

**Cypress Component Tests**:
- `TicketBoard.cy.ts` — verify canCreate/canUpdate react to permissions
- `UserManagement.cy.ts` — verify create/delete/toggle buttons respect permissions
- `TicketDetail.cy.ts` — verify edit/delete buttons respect permissions

---

#### Step 9: Integration Tests

**File**: `backend/integration-test/run.sh` — add permission-based test cases

**Test cases**:
1. User with `TICKET_CREATE` permission can create tickets
2. User without `TICKET_CREATE` permission gets 403
3. User with `TICKET_DELETE` permission can delete tickets
4. User without `TICKET_DELETE` permission gets 403
5. Permission endpoint returns correct codes for each role
6. Role-permission mapping is consistent (super_admin has all, user has least)

---

### c) Dependencies

- **Existing migrations**: `001_create_tables.sql`, `003_role_system.sql`, `004_persistence_layer.sql`
- **Existing middleware**: `auth.js` (provides `req.user` with `role` field)
- **Existing services**: `TicketService.js`, `UserService.js`, `ApprovalService.js`
- **Frontend auth store**: `stores/auth.js` (provides `user.role`)

---

### d) Risks/Edge Cases

- **[Risk] Cache stale after migration**: If migration runs while API is live, the in-memory cache won't have new permissions. **Mitigation**: Call `PermissionService.clearCache()` at the end of the migration script.

- **[Risk] Frontend permissions not loaded on route guard**: Navigation guards run before `loadRolePermissions()` completes. **Mitigation**: In the router guard, if permissions aren't loaded, fetch them synchronously (or block navigation until loaded).

- **[Risk] Ownership checks vs permission checks**: Some business logic checks ownership (`ticket.ownerId === userId`) as an exception to role-based rules. **Mitigation**: Permission check is the first gate; ownership is a secondary exception. Both checks remain.

- **[Risk] `requireRole` still used in some places**: If we miss a route migration, the old middleware still works. **Mitigation**: Add a lint rule or CI check that forbids `requireRole` imports (after all routes are migrated).

- **[Edge Case] New role without permission mapping**: If a role exists in `users.role` but not in `roles` table, `resolvePermissions()` returns an empty set. **Mitigation**: Migration validates that all existing role values have corresponding entries in the `roles` table.

- **[Edge Case] Permission code typos**: A typo in a permission code string won't be caught at compile time. **Mitigation**: Export permission codes as constants: `const PERM = { TICKET_CREATE: 'TICKET_CREATE', ... }` and use `PERM.TICKET_CREATE` everywhere.

---

### e) Testing

#### Unit Tests
- [ ] `PermissionService.resolvePermissions()` — all 4 roles return correct permission sets
- [ ] `PermissionService.hasPermission()` — true/false for known mappings
- [ ] `PermissionService.hasAnyPermission()` — OR logic works
- [ ] `PermissionService.hasAllPermissions()` — AND logic works
- [ ] `PermissionService.clearCache()` — cache is cleared
- [ ] `requireAnyPermission()` middleware — 403 for missing permission, 200 for present
- [ ] `requireAllPermissions()` middleware — requires all permissions
- [ ] Auth store `hasPermission()` — frontend permission checks work
- [ ] TicketService.update() — uses permission check
- [ ] UserService.createUser() — uses permission check
- [ ] ApprovalService.approve() — uses permission check

#### Integration Tests
- [ ] GET `/api/permissions/super_admin` returns all 26 codes
- [ ] GET `/api/permissions/user` returns 8 codes
- [ ] POST `/api/tickets` with TICKET_CREATE permission → 201
- [ ] POST `/api/tickets` without TICKET_CREATE permission → 403
- [ ] DELETE `/api/users/:id` with USER_DELETE permission → 200
- [ ] DELETE `/api/users/:id` without USER_DELETE permission → 403

#### Frontend Component Tests (Cypress)
- [ ] TicketBoard — canCreate hides when user lacks TICKET_CREATE
- [ ] TicketBoard — canUpdate hides when user lacks TICKET_UPDATE
- [ ] UserManagement — create button hidden when user lacks USER_CREATE
- [ ] UserManagement — delete button hidden when user lacks USER_DELETE
- [ ] TicketDetail — edit button hidden when user lacks TICKET_UPDATE
- [ ] App.vue — nav links show/hide based on permissions

#### E2E Tests (Cypress)
- [ ] Login as user role → can create tickets, cannot delete users
- [ ] Login as member role → can create tickets, cannot delete users
- [ ] Login as project_admin → can create tickets, can delete users
- [ ] Login as super_admin → full access

---

### f) Migration Notes

```sql
-- Migration: 005_permission_system.sql
-- Run BEFORE any code changes that depend on the new tables.
-- The migration is idempotent (ON CONFLICT DO NOTHING).
-- After migration, call PermissionService.clearCache() to reload.

-- Verify migration:
SELECT r.name, COUNT(rp.permission_id) as perms
FROM roles r LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.name ORDER BY r.name;

-- Expected output:
-- name         | perms
-- -------------+------
-- member       | 11
-- project_admin| 17
-- super_admin  | 26
-- user         | 8
```

---

### g) Notes

**Why 26 permissions?**: This covers all current API endpoints and business logic checks. New permissions can be added later by:
1. Inserting a row into `permissions` table
2. Mapping it to roles in `role_permissions`
3. Adding the permission check in code

**Why keep `users.role` as VARCHAR?**: Changing it to a FK `role_id` BIGINT requires migrating all existing user records and risks foreign key violations. The string value IS the role name — it's used as a lookup key into `role_permissions`. No functional loss.

**Permission codes naming convention**: `RESOURCE_ACTION` format (e.g., `TICKET_CREATE`, `USER_DELETE`). UPPERCASE with underscore separator. Consistent across backend and frontend.

**Backward compatibility**: Old `requireRole` middleware is NOT deleted in this ticket. It remains as a fallback. After all routes are migrated, a follow-up ticket can remove it.

**Frontend permission loading**: Permissions are fetched from the backend on login. This adds one extra API call but ensures frontend/backend parity. Alternative: embed permissions in the JWT token (simpler but requires token refresh on permission changes).

---

*Implementation plan complete. Update status as work progresses.*
