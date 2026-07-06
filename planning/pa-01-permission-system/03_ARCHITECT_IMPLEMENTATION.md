# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: pa-01 — Permission-Based Access Control System

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Large
**Author**: Lead Architect
**Date created**: 2026-06-07
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: `feature/permission-system`
**Scope**: Backend + Frontend

**Dependencies**: None

---

### a) Purpose

Replace scattered role-based access checks (`role === 'project_admin'`, `includes(['admin', 'member'])`) with a permission-based system where roles are mapped to granular permissions in the database. This eliminates the need to update dozens of files when adding or modifying roles, makes screen testing easier (assign permissions, not accounts), and provides a single source of truth for access control.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Database Migration]** — `backend/src/migrations/005_permission_system.sql`
   - Create 3 tables: `permissions`, `roles`, `role_permissions`
   - Seed 26 permissions, 4 roles, role-permission mappings
   - Add to `apply.js` SQL_FILES array
   - *Depends on*: nothing

2. **[Permission Service]** — `backend/src/services/PermissionService.js`
   - Create with `resolvePermissions()`, `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()`, `clearCache()`
   - In-memory cache (Map keyed by role name)
   - *Depends on*: Step 1

3. **[Permission Middleware]** — `backend/src/middleware/permissions.js`
   - Rewrite with `requireAnyPermission()`, `requireAllPermissions()`
   - *Depends on*: Step 2

4. **[Permissions API Endpoint]** — `backend/src/api/permissions.js`
   - Create `GET /api/permissions/:roleName`
   - Mount in `backend/src/api/v1/index.js`
   - *Depends on*: Steps 2, 3

5. **[Route Migration]** — 5 route files
   - Replace `requireRole()` with `requireAnyPermission()` / `requireAllPermissions()`
   - Files: `users.js`, `projects.js`, `tickets.js`, `agents.js`, `approvals.js`
   - *Depends on*: Steps 3, 4

6. **[Service-Level Migration]** — 4 service files
   - Replace inline role checks with `PermissionService.hasPermission()`
   - Files: `TicketService.js`, `UserService.js`, `ApprovalService.js`
   - *Depends on*: Steps 2, 5

7. **[Frontend Auth Store]** — `frontend/src/stores/auth.js`
   - Add `rolePermissions`, `hasPermission()`, `hasAnyPermission()`, `loadRolePermissions()`
   - *Depends on*: Step 4

8. **[Frontend Component Migration]** — 12 Vue files + router
   - Replace role checks with `hasPermission()`
   - Files: `TicketBoard.vue`, `TicketDetail.vue`, `UserManagement.vue`, `SuperAdminUsers.vue`, `TicketEditModal.vue`, `UserModal.vue`, `App.vue`, `router/index.ts`
   - *Depends on*: Steps 4, 7

9. **[Testing]** — All test layers
   - Unit tests, integration tests, bash integration suite, frontend component tests, E2E tests
   - *Depends on*: Steps 1-8

---

### c) Per-File Action Plan

#### `backend/src/migrations/005_permission_system.sql` (CREATE)
- **What to create**: New migration file
- **Position**: Added to `apply.js` SQL_FILES array (after 004, before 006)
- **Content**:
  ```sql
  -- permissions table (26 rows)
  -- roles table (4 rows)
  -- role_permissions table (62 rows)
  -- Indexes on role_id, permission_id
  ```
- **Rollback**: `005_permission_system_rollback.sql` — DROP tables

#### `backend/src/services/PermissionService.js` (CREATE)
- **Exports**: `resolvePermissions(roleName)`, `hasPermission(roleName, code)`, `hasAnyPermission(roleName, codes)`, `hasAllPermissions(roleName, codes)`, `clearCache()`
- **Logic**: SQL JOIN query → Map cache → Set lookup
- **Imports**: `const pool = require('../db')`

#### `backend/src/middleware/permissions.js` (MODIFY)
- **Change**: Rewrite existing unused file
- **Exports**: `requireAnyPermission(...codes)`, `requireAllPermissions(...codes)`
- **Logic**: Check `req.user.role` → call PermissionService → 401/403/next()
- **Imports**: `const PermissionService = require('../services/PermissionService')`

#### `backend/src/api/permissions.js` (CREATE)
- **Route**: `GET /api/permissions/:roleName` → `{ success: true, data: [permissionCodes] }`
- **Imports**: `const express = require('express')`, `PermissionService`
- **Mount**: `backend/src/api/v1/index.js` → `router.use('/permissions', permissionsRouter)`

#### `backend/src/api/users.js` (MODIFY)
- **Change**: Replace `requireRole()` with `requireAnyPermission()`
- **Lines**:
  - `POST /` → `requireAnyPermission('USER_CREATE')`
  - `PATCH /:id/toggle-active` → `requireAnyPermission('USER_TOGGLE_ACTIVE')`
  - `DELETE /:id` → `requireAnyPermission('USER_DELETE')`
  - `GET /super-admin` → `requireAnyPermission('USER_VIEW_ALL')`

#### `backend/src/api/projects.js` (MODIFY)
- **Change**: Replace `requireRole()` with `requireAnyPermission()`
- **Line**: `DELETE /tickets/:id` → `requireAnyPermission('TICKET_DELETE')`

#### `backend/src/api/tickets.js` (MODIFY)
- **Change**: Replace `requireRole()` with `requireAnyPermission()`
- **Line**: `DELETE /tickets/:id` → `requireAnyPermission('TICKET_DELETE')`

#### `backend/src/api/agents.js` (MODIFY)
- **Change**: Replace `requireRole()` with `requireAnyPermission()`
- **Lines**:
  - `POST /agents/create` → `requireAnyPermission('AGENT_CREATE')`
  - `POST /agents/revoke/:id` → `requireAnyPermission('AGENT_REVOKE')`
  - `DELETE /agents/:id` → `requireAnyPermission('AGENT_DELETE')`

#### `backend/src/api/approvals.js` (MODIFY)
- **Change**: Replace `requireRole()` with `requireAnyPermission()`
- **Lines**:
  - `POST /:id/approve` → `requireAnyPermission('APPROVAL_APPROVE')`
  - `POST /:id/reject` → `requireAnyPermission('APPROVAL_REJECT')`
  - `GET /` → `requireAnyPermission('APPROVAL_VIEW')`

#### `backend/src/services/TicketService.js` (MODIFY)
- **Change**: Replace inline role checks with `PermissionService.hasPermission()`
- **Position**: `update()` and `delete()` methods

#### `backend/src/services/UserService.js` (MODIFY)
- **Change**: Replace inline role checks with `PermissionService.hasPermission()`
- **Position**: `createUser()` role hierarchy, `listUsers()` filtering

#### `backend/src/services/ApprovalService.js` (MODIFY)
- **Change**: Replace inline role checks with `PermissionService.hasPermission()`
- **Position**: `approve()`, `reject()` methods

#### `frontend/src/stores/auth.js` (MODIFY)
- **Add**: `rolePermissions: ref(new Set())`
- **Add**: `hasPermission(code)`, `hasAnyPermission(codes)`, `loadRolePermissions()`
- **Position**: After existing auth store state

#### `frontend/src/views/TicketBoard.vue` (MODIFY)
- **Change**: Replace role checks with `hasPermission()`
- **Lines**: ~40 (canCreate), ~87 (canUpdate)

#### `frontend/src/views/TicketDetail.vue` (MODIFY)
- **Change**: Replace role checks with `hasPermission()`
- **Lines**: ~39 (canUpdate), ~47 (canDelete)

#### `frontend/src/views/UserManagement.vue` (MODIFY)
- **Change**: Replace role checks with `hasPermission()`
- **Lines**: ~19 (canCreate), ~24 (canDelete), ~29 (canToggle)

#### `frontend/src/views/SuperAdminUsers.vue` (MODIFY)
- **Change**: Replace role check with `hasPermission()`
- **Line**: template `user.role !== 'super_admin'` → `!hasPermission('USER_VIEW_ALL')`

#### `frontend/src/views/TicketEditModal.vue` (MODIFY)
- **Change**: Replace role check with `hasPermission()`
- **Line**: ~25 (canEdit)

#### `frontend/src/views/UserModal.vue` (MODIFY)
- **Change**: Replace role checks with `hasPermission()`
- **Lines**: ~22, ~27 (canCreate)

#### `frontend/src/views/App.vue` (MODIFY)
- **Change**: Replace role checks with `hasPermission()`
- **Lines**: ~42 (canViewUsers), ~48 (canViewAllUsers)

#### `frontend/src/router/index.ts` (MODIFY)
- **Change**: Replace role-based route guards with permission-based guards
- **Line**: ~100 (route guard)

---

### d) Dependencies

- **Existing migrations**: `001_create_tables.sql`, `003_role_system.sql`, `004_persistence_layer.sql`
- **Existing middleware**: `auth.js` (provides `req.user` with `role` field)
- **Existing services**: `TicketService.js`, `UserService.js`, `ApprovalService.js`
- **Frontend auth store**: `stores/auth.js` (provides `user.role`)

---

### e) Risks/Edge Cases

- **[Risk] Cache stale after migration**: If migration runs while API is live, the in-memory cache won't have new permissions. **Mitigation**: Call `PermissionService.clearCache()` at the end of the migration script.

- **[Risk] Frontend permissions not loaded on route guard**: Navigation guards run before `loadRolePermissions()` completes. **Mitigation**: In the router guard, if permissions aren't loaded, fetch them synchronously (or block navigation until loaded).

- **[Risk] Ownership checks vs permission checks**: Some business logic checks ownership (`ticket.ownerId === userId`) as an exception to role-based rules. **Mitigation**: Permission check is the first gate; ownership is a secondary exception. Both checks remain.

- **[Risk] `requireRole` still used in some places**: If we miss a route migration, the old middleware still works. **Mitigation**: Add a lint rule or CI check that forbids `requireRole` imports (after all routes are migrated).

- **[Edge Case] New role without permission mapping**: If a role exists in `users.role` but not in `roles` table, `resolvePermissions()` returns an empty set. **Mitigation**: Migration validates that all existing role values have corresponding entries in the `roles` table.

- **[Edge Case] Permission code typos**: A typo in a permission code string won't be caught at compile time. **Mitigation**: Export permission codes as constants: `const PERM = { TICKET_CREATE: 'TICKET_CREATE', ... }` and use `PERM.TICKET_CREATE` everywhere.

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- [ ] Test PermissionService: `backend/src/__tests__/permissionService.test.js` — CREATED
  - `resolvePermissions('super_admin')` returns all 26 permissions
  - `resolvePermissions('user')` returns 8 permissions
  - `hasPermission('project_admin', 'USER_DELETE')` returns false
  - `hasPermission('project_admin', 'TICKET_CREATE')` returns true
  - `hasAnyPermission('user', ['USER_DELETE', 'TICKET_CREATE'])` returns true
  - `hasAllPermissions('user', ['USER_DELETE', 'TICKET_CREATE'])` returns false
  - `clearCache()` clears the in-memory cache
  - Cached results are returned without DB call on second lookup
- [ ] Test middleware: `backend/src/middleware/permissions.test.js` — CREATED
  - `requireAnyPermission('TICKET_CREATE')` allows user with TICKET_CREATE
  - `requireAnyPermission('TICKET_CREATE')` rejects user without TICKET_CREATE
  - `requireAllPermissions('A', 'B')` requires both permissions
  - Unauthenticated request returns 401
- [ ] Test service methods: EXTEND `backend/src/__tests__/unit.test.js`
  - `TicketService.update()` — permission check rejects unauthorized roles
  - `TicketService.delete()` — permission check rejects unauthorized roles
  - `UserService.createUser()` — permission check rejects unauthorized creators
  - `ApprovalService.approve()` — permission check rejects unauthorized approvers
- [ ] Every new controller method has at least one test case
- [ ] Every new service method has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] Code coverage: run `npm run test:coverage` — no significant decrease in changed modules

#### Backend Jest Integration Tests
- [ ] Full request lifecycle: HTTP → middleware → controller → service → DB → response
- [ ] Role-based access: correct 403 responses for missing permissions
- [ ] Data persistence: inserted/updated data survives across requests
- [ ] Error handling: invalid requests return proper error responses
- [ ] `backend/src/__tests__/integration/api-permissions.test.js` — CREATED
  - GET `/api/permissions/super_admin` returns all 26 codes
  - GET `/api/permissions/user` returns 8 codes
  - GET `/api/permissions/nonexistent` returns 404

#### Backend Bash Integration Suite
**Add a curl-based test in `backend/integration-test/suites/permissions.test.sh` for backend API changes.**
- [ ] New suite file: `backend/integration-test/suites/permissions.test.sh` — CREATED
- [ ] Test function registered in `backend/integration-test/run.sh` `main()` function
- [ ] Suite covers:
  - GET `/api/permissions/super_admin` → 200 with all 26 codes
  - GET `/api/permissions/user` → 200 with 8 codes
  - GET `/api/permissions/nonexistent` → 404
  - POST `/api/tickets` with TICKET_CREATE permission → 201
  - POST `/api/tickets` without TICKET_CREATE permission → 403
  - DELETE `/api/users/:id` with USER_DELETE permission → 200
  - DELETE `/api/users/:id` without USER_DELETE permission → 403
- [ ] Multi-step flows tested where applicable (create → read → update → delete → verify gone)
- [ ] Suite runs cleanly: `cd backend && bash integration-test/run.sh --only`

#### Frontend Unit Tests
- [ ] Auth store: `frontend/src/__tests__/authStore.test.ts` — CREATED
  - `hasPermission('TICKET_CREATE')` returns true for project_admin
  - `hasPermission('USER_DELETE')` returns false for member
  - `hasAnyPermission(['USER_DELETE', 'TICKET_CREATE'])` returns true for member (has TICKET_CREATE)
- [ ] Component rendering: EXTEND existing component tests
- [ ] Every new API client function has at least one test case
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

#### Frontend E2E Tests
- [ ] Login as user role → can create tickets, cannot delete users
- [ ] Login as member role → can create tickets, cannot delete users
- [ ] Login as project_admin → can create tickets, can delete users
- [ ] Login as super_admin → full access

#### Frontend Contract Tests
- [ ] Response schema updated in `frontend/src/api/validator.ts` — UPDATED for permissions endpoint
- [ ] Contract test: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED with permissions endpoint tests
- [ ] Field names match (permissions endpoint returns `{ success: true, data: [permissionCodes] }`)
- [ ] Generated types regenerated: `cd frontend && npm run generate:spec && npm run generate:api` (after backend JSDoc updates)
- [ ] Generated types compile: `cd frontend && npm run typecheck`

---

### g) Migration Notes

```sql
-- Migration: 005_permission_system.sql

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

- [ ] Migration file: `backend/src/migrations/005_permission_system.sql`
- [ ] Migration applied in correct position in `backend/src/migrations/apply.js`
- [ ] Rollback file: `backend/src/migrations/005_permission_system_rollback.sql`
- [ ] Rollback tested: can reverse without data loss

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/005_permission_system.sql            → CREATE (migration)
backend/src/migrations/apply.js                             → MODIFY (add to SQL_FILES)
backend/src/services/PermissionService.js                   → CREATE (permission service)
backend/src/middleware/permissions.js                       → MODIFY (rewrite)
backend/src/api/permissions.js                              → CREATE (new route)
backend/src/api/v1/index.js                                 → MODIFY (mount permissions router)
backend/src/api/users.js                                    → MODIFY (replace requireRole)
backend/src/api/projects.js                                 → MODIFY (replace requireRole)
backend/src/api/tickets.js                                  → MODIFY (replace requireRole)
backend/src/api/agents.js                                   → MODIFY (replace requireRole)
backend/src/api/approvals.js                                → MODIFY (replace requireRole)
backend/src/services/TicketService.js                       → MODIFY (replace inline role checks)
backend/src/services/UserService.js                         → MODIFY (replace inline role checks)
backend/src/services/ApprovalService.js                     → MODIFY (replace inline role checks)
```

**Frontend:**
```
frontend/src/stores/auth.js              → MODIFY (add permission helpers)
frontend/src/views/TicketBoard.vue       → MODIFY (replace role checks)
frontend/src/views/TicketDetail.vue      → MODIFY (replace role checks)
frontend/src/views/UserManagement.vue    → MODIFY (replace role checks)
frontend/src/views/SuperAdminUsers.vue   → MODIFY (replace role checks)
frontend/src/views/TicketEditModal.vue   → MODIFY (replace role checks)
frontend/src/views/UserModal.vue         → MODIFY (replace role checks)
frontend/src/views/App.vue               → MODIFY (replace role checks)
frontend/src/router/index.ts             → MODIFY (update route guards)
frontend/src/api/generated/              → REGENERATE (types)
```

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers permissions endpoint
- [ ] Bash integration suite test added or extended for API changes
- [ ] Coverage checked: no significant decrease in changed modules
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented

---

### j) Post-Deploy Verification

1. [ ] `npm test` passes (backend unit tests)
2. [ ] `npm run test:integration` passes (backend integration tests)
3. [ ] `cd backend && bash integration-test/run.sh --only` passes (bash integration suite)
4. [ ] `npm run lint` passes (backend + frontend)
5. [ ] `npm run typecheck` passes (frontend)
6. [ ] `npm run build` passes (frontend)
7. [ ] `npm run test:coverage` — no significant decrease in changed modules
8. [ ] Migration runs successfully: `cd backend && npm run db:migrate`
9. [ ] Permissions endpoint works: `curl http://localhost:3001/api/permissions/super_admin` → 200 with 26 codes
10. [ ] Permission-based route guards work (403 for missing permissions)
11. [ ] Frontend auth store loads permissions on login
12. [ ] Frontend UI respects permissions (buttons show/hide correctly)
13. [ ] E2E tests pass for all 4 roles (user, member, project_admin, super_admin)

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
