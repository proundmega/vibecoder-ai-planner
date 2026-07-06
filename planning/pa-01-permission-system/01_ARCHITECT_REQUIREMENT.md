# 01_ARCHITECT_REQUIREMENT.md — Permission System Requirements

**Status**: Draft
**Author**: Lead Architect
**Scope**: Replace role-based checks with a permission-based access control system
**Created**: 2026-06-07

---

## Problem Statement

The current system uses role names (`super_admin`, `project_admin`, `member`, `user`) directly in checks scattered across backend services, controllers, middleware, and frontend components. Every time a new role is added or an existing role's capabilities change, dozens of files must be updated. This creates:

- **Maintenance burden**: Adding a role requires updating every `role ===` or `includes(role)` check
- **Inconsistency**: Frontend and backend can drift out of sync
- **Testing friction**: Screen testing requires logging in with specific role accounts to verify access
- **No granularity**: A role is an all-or-nothing concept — you can't give someone "ticket create but not ticket delete"
- **Dead code accumulation**: Legacy role name checks (`ADMIN`, `MEMBER`, `USER`) persist because nobody wants to touch the tangled web of role checks

**Current state**: Role checks exist in 25+ files across backend and frontend. Adding one new role requires touching at least 15 files.

---

## Goals

1. **Single source of truth**: Define roles and their permissions in the database, not in code
2. **Permission-first checks**: Code checks `hasPermission('TICKET_CREATE')` instead of `role === 'project_admin'`
3. **Easy role composition**: Adding a new role means inserting one row into `roles` + mapping rows in `role_permissions`
4. **Frontend/backend parity**: Both check the same permission system
5. **Screen-testable**: QA can test by assigning permissions, not by creating role-specific accounts

---

## Functional Requirements

### FR-1: Permission Definitions
- System must define a set of granular permissions
- Each permission has a unique code (e.g., `TICKET_CREATE`) and description
- Permissions are application-wide (not per-project)

### FR-2: Role Definitions
- System must define roles as named collections of permissions
- Each role has a name, description, and display label
- Roles are immutable once assigned to users (same as current behavior)

### FR-3: Role-Permission Mapping
- A many-to-many relationship between roles and permissions
- A role can have zero or more permissions
- A permission can be assigned to zero or more roles

### FR-4: Permission Checks in Backend
- Middleware or service methods must check permissions, not roles
- A user has a permission if their role has that permission
- Super admin bypass may exist for platform operators

### FR-5: Permission Checks in Frontend
- Frontend must check permissions, not roles
- UI elements conditionally render based on permissions
- API calls fail with 403 if user lacks permission (defense in depth)

### FR-6: Backward Compatibility
- Existing `users.role` column remains for lookup (not removed)
- Migration populates new tables from existing role data
- Existing user data is preserved

### FR-7: Default Role Permissions
- `super_admin`: All permissions
- `project_admin`: Full project control permissions
- `member`: Team collaboration permissions
- `user`: AI agent permissions (create/update own tickets)

---

## Permission Enumeration (Initial Set)

| Permission Code | Description | Routes/Actions Affected |
|----------------|-------------|------------------------|
| `TICKET_CREATE` | Create new tickets | `POST /api/tickets` |
| `TICKET_READ` | Read/view tickets | `GET /api/tickets/*` |
| `TICKET_UPDATE` | Update ticket fields | `PATCH /api/tickets/:id` |
| `TICKET_DELETE` | Delete tickets | `DELETE /api/tickets/:id`, `DELETE /projects/tickets/:id` |
| `TICKET_STATUS_CHANGE` | Change ticket status | `PATCH /api/tickets/:id/status` |
| `TICKET_COMMENT` | Add comments to tickets | `POST /api/tickets/:id/comments` |
| `PROJECT_CREATE` | Create new projects | `POST /api/projects` |
| `PROJECT_READ` | View projects | `GET /api/projects/*` |
| `PROJECT_UPDATE` | Update project details | `PATCH /api/projects/:id` |
| `PROJECT_DELETE` | Delete projects | `DELETE /api/projects/:id` |
| `PROJECT_MANAGE_MEMBERS` | Add/remove project members | `POST /api/projects/:id/members` |
| `USER_CREATE` | Create user accounts | `POST /api/users` |
| `USER_READ` | View user accounts | `GET /api/users/*` |
| `USER_UPDATE` | Update user details | `PATCH /api/users/:id` |
| `USER_DELETE` | Delete user accounts | `DELETE /api/users/:id` |
| `USER_TOGGLE_ACTIVE` | Activate/deactivate users | `PATCH /api/users/:id/toggle-active` |
| `USER_VIEW_ALL` | View all users (platform-wide) | `GET /api/users/super-admin` |
| `AGENT_CREATE` | Create AI agents | `POST /api/agents/create` |
| `AGENT_READ` | View AI agents | `GET /api/agents/*` |
| `AGENT_REVOKE` | Revoke agent API key | `POST /api/agents/revoke/:agentId` |
| `AGENT_DELETE` | Delete AI agents | `DELETE /api/agents/:agentId` |
| `APPROVAL_APPROVE` | Approve tickets | `POST /api/approvals/:id/approve` |
| `APPROVAL_REJECT` | Reject tickets | `POST /api/approvals/:id/reject` |
| `APPROVAL_VIEW` | View approval requests | `GET /api/approvals` |
| `PRICING_READ` | View pricing info | `GET /api/pricing` |
| `DASHBOARD_READ` | Access dashboard | `GET /api/dashboard` |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/005_permission_system.sql` | CREATE | New migration: 3 tables + seed data |
| `backend/src/migrations/apply.js` | MODIFY | Add 005_permission_system.sql to SQL_FILES array |
| `backend/src/services/PermissionService.js` | CREATE | New service: permission resolution + caching |
| `backend/src/middleware/permissions.js` | MODIFY | Rewrite: permission-based middleware |
| `backend/src/api/permissions.js` | CREATE | New route: GET /permissions/:roleName |
| `backend/src/api/v1/index.js` | MODIFY | Mount permissions router |
| `backend/src/api/*.js` (5 files) | MODIFY | Replace requireRole with permission middleware |
| `backend/src/services/*.js` (4 files) | MODIFY | Replace inline role checks with PermissionService |
| `frontend/src/stores/auth.js` | MODIFY | Add permission helpers + loadRolePermissions |
| `frontend/src/views/*.vue` (12 files) | MODIFY | Replace role checks with hasPermission |
| `frontend/src/router/index.ts` | MODIFY | Update route guards |
| `database` | NEW MIGRATION | 3 new tables: permissions, roles, role_permissions |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Exact line numbers for route guards]**: The 11 route definitions across 5 files may have shifted. **Resolution**: grep for `requireRole` in `backend/src/api/` to find actual locations.
2. **[Exact line numbers for service checks]**: Inline role checks in TicketService, UserService, ApprovalService may have shifted. **Resolution**: grep for `user.role !==` or `role ===` in `backend/src/services/` to find actual locations.
3. **[Exact line numbers for frontend components]**: 12 Vue files with role checks may have shifted. **Resolution**: grep for `role ===` or `includes(role)` in `frontend/src/views/` to find actual locations.
4. **[Router guard permissions loading]**: Navigation guards run before `loadRolePermissions()` completes. **Resolution**: Fetch permissions synchronously in the guard or block navigation until loaded.

---

## Non-Functional Requirements

### NFR-1: Performance
- Permission checks must not add measurable latency
- Cache role-permission mappings in memory (reload on migration)
- Single DB query to resolve all permissions for a user's role

### NFR-2: Testability
- Adding a permission or changing a role's permissions must be testable by inserting test data, not by modifying code
- Integration tests should verify permission checks against the database

### NFR-3: Auditability
- Track which roles have which permissions (for security audits)
- Permission changes logged (future enhancement)

### NFR-4: Extensibility
- New permissions can be added without code changes (just DB insert)
- New roles can be added without code changes (just DB inserts)
- Permission checks in code use the permission code string — no enum updates needed

---

## Constraints

- Existing `users.role` column stays — it acts as a foreign key to the `roles` table
- Roles remain immutable once assigned to a user (no `updateRole()` endpoint)
- `super_admin` is still created manually in DB only
- The permission system supplements, not replaces, existing business logic (status transitions, ownership checks, etc.)

---

## Out of Scope

- Fine-grained permissions that vary by project (e.g., "can edit tickets in Project A but not Project B") — this would require a `user_project_permissions` table and is a future enhancement
- Runtime permission management via API (adding/removing permissions to roles through the UI)
- Permission inheritance chains (A includes B's permissions) — roles are explicit
- Attribute-based access control (ABAC) — this is RBAC with granular permissions, not full ABAC
- Removing old `requireRole` middleware (deferred to a follow-up ticket)

---

## Performance Considerations

- Expected load: High — permission checks run on every authenticated request
- N+1 queries to avoid: Single SQL query per role resolution (cached in memory)
- Caching strategy: In-memory `Map` keyed by role name, cleared after migrations
- Pagination needed: N/A

---

## Security Considerations

- Authentication required: YES (all permission checks require auth)
- Authorization check: YES (permission-based, replaces role-based)
- Input validation: YES (permission codes validated against enum in code)
- Rate limiting: N/A (permission checks are fast, no rate limiting needed)
- Sensitive data handling: Permission codes are not secrets, but role-permission mappings should not be exposed to unauthorized users (GET /permissions/:roleName requires auth)

---

## Testing Checklist

### Backend Tests
- [ ] Unit test files CREATED for `PermissionService.js` — `backend/src/__tests__/permissionService.test.js`
- [ ] Unit test files CREATED for `permissions.js` middleware — `backend/src/middleware/permissions.test.js`
- [ ] Unit test files CREATED for `permissions.js` API endpoint — `backend/src/__tests__/api-permissions.test.js`
- [ ] Unit tests: `backend/src/__tests__/unit.test.js` — EXTENDED for TicketService, UserService, ApprovalService
- [ ] Middleware tests: `backend/src/middleware/permissions.test.js` — CREATED (auth, permissions, 401/403 responses)
- [ ] API endpoint tests: `backend/src/__tests__/api-*.test.js` — EXTENDED for each migrated route
- [ ] Jest integration tests: `backend/src/__tests__/integration/` — CREATED for permission-based access control
- [ ] **Bash integration suite**: test added or extended in `backend/integration-test/suites/` — CREATED for permission endpoints and role-based access
- [ ] Every new controller method has at least one test case
- [ ] Every new service method has at least one test case
- [ ] Every new validator schema has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] Code coverage: run `npm run test:coverage` — no significant decrease in changed modules

### Frontend Tests
- [ ] Unit test files CREATED for auth store permission helpers — `frontend/src/__tests__/authStore.test.ts`
- [ ] Unit tests: `frontend/src/__tests__/` — EXTENDED for components with role checks
- [ ] Component tests: `frontend/cypress/component/` — CREATED for permission-based UI elements
- [ ] E2E tests: `frontend/cypress/e2e/` — CREATED for permission-based user flows
- [ ] API contract tests: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED for permissions endpoint
- [ ] Response validation: `frontend/src/api/validator.ts` — UPDATED for permissions response shape
- [ ] Every new API client function has at least one test case
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors (backend + frontend)
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — check `frontend/src/api/`, `frontend/src/views/`, `frontend/src/components/` before creating
- ❌ **Duplicating existing patterns** — follow the style of `frontend/src/api/tickets.js`, `frontend/src/api/projects.js`, etc.
- ❌ **Ignoring the existing tab structure** — if `ProjectDetail.vue` has tabs, add new features as tabs, not new pages
- ❌ **Creating new API clients from scratch** — use the same `get`, `post`, `put`, `del`, `patch` imports from `./client`
- ❌ **Ignoring OpenAPI spec** — if backend routes change, update JSDoc and regenerate frontend types
- ❌ **Snake_case/camelCase mismatches** — backend uses snake_case, frontend API clients must convert to camelCase
- ❌ **Hardcoding API paths** — use the same pattern as existing API clients (e.g., `/api/v1/github/${projectId}/repo`)
- ❌ **Skipping error handling** — all API calls must use `.catch()` or try/catch
- ❌ **Testing only happy paths** — test error cases, empty states, loading states
- ❌ **Merging without tests** — every change must have tests; new/changed code requires new/modified test files, not just verifying existing tests still pass
- ❌ **No bash integration test for backend changes** — if the change adds or modifies an API endpoint, add a curl-based test in `backend/integration-test/suites/`
- ❌ **Skipping the bash integration suite** — `backend/integration-test/run.sh --only` should pass before merging backend changes
- ❌ **Response validation not updated** — if backend response shapes change, update `frontend/src/api/validator.ts` and `frontend/src/__tests__/api-contract.test.ts`
- ❌ **Contract test not updated** — if a field name, type, or enum changes in an API response, the contract test must be updated to match
- ❌ **Generated types stale** — after OpenAPI spec changes, regenerate types and verify they compile (`npm run generate:spec && npm run generate:api && npm run typecheck`); consider importing them instead of hand-writing types
- ❌ **Ignoring coverage regressions** — run `npm run test:coverage` and check that coverage in changed modules doesn't drop significantly
- ❌ **Skipping the Specification file** — if a small model will execute this ticket, fill out `04_SPECIFICATION.md` with exact file operations
- ❌ **Using `requireRole` after migration** — all route guards should use `requireAnyPermission` or `requireAllPermissions`
- ❌ **Using inline role checks after migration** — all service-level checks should use `PermissionService.hasPermission()`
- ❌ **Forgetting to clear permission cache after migration** — call `PermissionService.clearCache()` at the end of the migration

---

*This document defines what the permission system must do. See `02_ARCHITECT_DESIGN.md` for how it will be built.*
