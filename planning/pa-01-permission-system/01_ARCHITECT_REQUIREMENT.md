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
- Runtime permission management via API (adding/removing permissions from roles through the UI)
- Permission inheritance chains (A includes B's permissions) — roles are explicit
- Attribute-based access control (ABAC) — this is RBAC with granular permissions, not full ABAC

---

*This document defines what the permission system must do. See `02_ARCHITECT_DESIGN.md` for how it will be built.*
