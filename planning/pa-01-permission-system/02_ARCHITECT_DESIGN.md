# 02_ARCHITECT_DESIGN.md — Permission System Design Specification

**Status**: Working draft
**Author**: Lead Architect
**Scope**: Database schema, architecture, role-permission mappings, migration strategy
**Created**: 2026-06-07

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     PERMISSION SYSTEM                       │
│                                                             │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────┐ │
│  │  permissions  │◄──►│  role_permissions │◄──►│   roles   │ │
│  │  (id, code,   │    │  (role_id, perm) │    │ (id, name,│ │
│  │   desc)       │    └──────────────────┘    │  desc)    │ │
│  └──────────────┘                             └───────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  users.role → references roles.name (FK)            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  PermissionCheckService.resolve(role) → Set<String>  │   │
│  │  PermissionCheckService.has(user, permission) → bool │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/005_permission_system.sql` | CREATE | New migration: 3 tables + seed data |
| `backend/src/migrations/apply.js` | MODIFY | Add 005_permission_system.sql to SQL_FILES array |
| `backend/src/services/PermissionService.js` | CREATE | New service: permission resolution + caching |
| `backend/src/middleware/permissions.js` | MODIFY | Rewrite: permission-based middleware |
| `backend/src/api/permissions.js` | CREATE | New route: GET /permissions/:roleName |
| `backend/src/api/v1/index.js` | MODIFY | Mount permissions router |
| `backend/src/api/users.js` | MODIFY | Replace requireRole with permission middleware |
| `backend/src/api/projects.js` | MODIFY | Replace requireRole with permission middleware |
| `backend/src/api/tickets.js` | MODIFY | Replace requireRole with permission middleware |
| `backend/src/api/agents.js` | MODIFY | Replace requireRole with permission middleware |
| `backend/src/api/approvals.js` | MODIFY | Replace requireRole with permission middleware |
| `backend/src/services/TicketService.js` | MODIFY | Replace inline role checks with PermissionService |
| `backend/src/services/UserService.js` | MODIFY | Replace inline role checks with PermissionService |
| `backend/src/services/ApprovalService.js` | MODIFY | Replace inline role checks with PermissionService |
| `frontend/src/stores/auth.js` | MODIFY | Add permission helpers + loadRolePermissions |
| `frontend/src/views/TicketBoard.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/views/UserManagement.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/views/SuperAdminUsers.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/views/TicketEditModal.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/views/UserModal.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/views/App.vue` | MODIFY | Replace role checks with hasPermission |
| `frontend/src/router/index.ts` | MODIFY | Update route guards |

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/permissionService.test.js` | PermissionService methods, cache behavior |
| Middleware | Jest | `backend/src/middleware/permissions.test.js` | requireAnyPermission, requireAllPermissions |
| Jest integration | Jest + real PG | `backend/src/__tests__/integration/api-permissions.test.js` | Full request lifecycle, role-based access |
| **Bash integration** | curl + helpers | `backend/integration-test/suites/permissions.test.sh` | Real API responses, multi-step flows |
| Frontend unit | Vitest | `frontend/src/__tests__/authStore.test.ts` | hasPermission, hasAnyPermission helpers |
| Frontend contract | Vitest | `frontend/src/__tests__/api-contract.test.ts` | Permissions endpoint response shape |
| Frontend component | Cypress | `frontend/cypress/component/` | Permission-based UI elements |
| Frontend E2E | Cypress | `frontend/cypress/e2e/` | Full permission-based user flows |

### Bash Integration Suite — When to Add Tests

Add a new `.test.sh` suite in `backend/integration-test/suites/permissions.test.sh` for:
- GET `/api/permissions/super_admin` → 200 with all 26 codes
- GET `/api/permissions/user` → 200 with 8 codes
- GET `/api/permissions/nonexistent` → 404
- POST `/api/tickets` with TICKET_CREATE permission → 201
- POST `/api/tickets` without TICKET_CREATE permission → 403
- DELETE `/api/users/:id` with USER_DELETE permission → 200
- DELETE `/api/users/:id` without USER_DELETE permission → 403

### Frontend-Backend Contract Testing

- Response schemas in `frontend/src/api/validator.ts` must include permissions endpoint response: `{ success: true, data: [permissionCodes] }`
- If the contract test has a permissions shape assertion, verify it matches the backend's actual response
- Generated TypeScript types from OpenAPI spec should include the permissions response — verify by running `npm run generate:spec && npm run generate:api && npm run typecheck`

---

## Security Considerations

- New endpoints require authentication: YES — `GET /permissions/:roleName` requires auth
- New endpoints require specific permissions: N/A — permissions endpoint returns permissions for the authenticated user's own role
- Input validated against: Joi schema for role name (must exist in roles table)
- Rate limiting: N/A — permission checks are fast, no rate limiting needed
- Sensitive data in responses: Permission codes are not secrets, but role-permission mappings should not be exposed to unauthorized users
- SQL injection protection: Parameterized queries used in PermissionService

---

## Database Schema

### New Tables

```sql
-- 005_permission_system.sql

-- Permissions table: defines all available permissions in the system
CREATE TABLE IF NOT EXISTS permissions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Roles table: defines all roles and their display names
CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role-Permission mapping: many-to-many relationship
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Index for fast permission lookup by role
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);

-- Seed permissions
INSERT INTO permissions (code, description) VALUES
  ('TICKET_CREATE',       'Create new tickets'),
  ('TICKET_READ',         'Read/view tickets'),
  ('TICKET_UPDATE',       'Update ticket fields'),
  ('TICKET_DELETE',       'Delete tickets'),
  ('TICKET_STATUS_CHANGE','Change ticket status'),
  ('TICKET_COMMENT',      'Add comments to tickets'),
  ('PROJECT_CREATE',      'Create new projects'),
  ('PROJECT_READ',        'View projects'),
  ('PROJECT_UPDATE',      'Update project details'),
  ('PROJECT_DELETE',      'Delete projects'),
  ('PROJECT_MANAGE_MEMBERS', 'Add/remove project members'),
  ('USER_CREATE',         'Create user accounts'),
  ('USER_READ',           'View user accounts'),
  ('USER_UPDATE',         'Update user details'),
  ('USER_DELETE',         'Delete user accounts'),
  ('USER_TOGGLE_ACTIVE',  'Activate/deactivate users'),
  ('USER_VIEW_ALL',       'View all users (platform-wide)'),
  ('AGENT_CREATE',        'Create AI agents'),
  ('AGENT_READ',          'View AI agents'),
  ('AGENT_REVOKE',        'Revoke agent API key'),
  ('AGENT_DELETE',        'Delete AI agents'),
  ('APPROVAL_APPROVE',    'Approve tickets'),
  ('APPROVAL_REJECT',     'Reject tickets'),
  ('APPROVAL_VIEW',       'View approval requests'),
  ('PRICING_READ',        'View pricing info'),
  ('DASHBOARD_READ',      'Access dashboard')
ON CONFLICT (code) DO NOTHING;

-- Seed roles
INSERT INTO roles (name, description, display_name) VALUES
  ('super_admin',   'Full platform access, view all users, manage everything'),
  ('project_admin', 'Full project control: manage tickets, AI keys, create members'),
  ('member',        'Team lead/reviewer: manage tickets, review work, create users'),
  ('user',          'AI agent: create/update own tickets, read AI tokens')
ON CONFLICT (name) DO NOTHING;

-- Map super_admin → all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- Map project_admin → project + ticket + agent permissions (no user management, no super_admin)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'project_admin'
  AND p.code IN (
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_DELETE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
    'PROJECT_CREATE', 'PROJECT_READ', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'PROJECT_MANAGE_MEMBERS',
    'USER_CREATE', 'USER_READ',
    'AGENT_CREATE', 'AGENT_READ', 'AGENT_DELETE',
    'APPROVAL_APPROVE', 'APPROVAL_REJECT', 'APPROVAL_VIEW',
    'PRICING_READ', 'DASHBOARD_READ'
  )
ON CONFLICT DO NOTHING;

-- Map member → team collaboration permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'member'
  AND p.code IN (
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_DELETE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
    'PROJECT_READ',
    'USER_CREATE', 'USER_READ',
    'APPROVAL_APPROVE', 'APPROVAL_REJECT', 'APPROVAL_VIEW',
    'AGENT_READ',
    'PRICING_READ', 'DASHBOARD_READ'
  )
ON CONFLICT DO NOTHING;

-- Map user → AI agent permissions (minimal)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'user'
  AND p.code IN (
    'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
    'PROJECT_READ',
    'AGENT_READ',
    'PRICING_READ', 'DASHBOARD_READ'
  )
ON CONFLICT DO NOTHING;
```

---

## Permission Check Service

**File**: `backend/src/services/PermissionService.js`

```javascript
const pool = require('../db');

// In-memory cache: role_name → Set of permission codes
// Reloads on demand or after migration
const permissionCache = new Map();

/**
 * Resolve all permission codes for a given role name.
 * Cached after first call per role.
 */
async function resolvePermissions(roleName) {
  if (permissionCache.has(roleName)) {
    return permissionCache.get(roleName);
  }

  const result = await pool.query(`
    SELECT p.code FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN roles r ON r.id = rp.role_id
    WHERE r.name = $1
  `, [roleName]);

  const permissions = new Set(result.rows.map(row => row.code));
  permissionCache.set(roleName, permissions);
  return permissions;
}

/**
 * Check if a user (by role name) has a specific permission.
 * Single cached lookup.
 */
async function hasPermission(roleName, permissionCode) {
  const permissions = await resolvePermissions(roleName);
  return permissions.has(permissionCode);
}

/**
 * Check if a user has ANY of the given permissions.
 */
async function hasAnyPermission(roleName, permissionCodes) {
  const permissions = await resolvePermissions(roleName);
  return permissionCodes.some(code => permissions.has(code));
}

/**
 * Check if a user has ALL of the given permissions.
 */
async function hasAllPermissions(roleName, permissionCodes) {
  const permissions = await resolvePermissions(roleName);
  return permissionCodes.every(code => permissions.has(code));
}

/**
 * Clear the permission cache (call after migrations).
 */
function clearCache() {
  permissionCache.clear();
}

module.exports = {
  resolvePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  clearCache,
};
```

---

## Permission Middleware

**File**: `backend/src/middleware/permissions.js` (rewrite of existing unused file)

```javascript
const PermissionService = require('../services/PermissionService');

/**
 * Require the user to have at least ONE of the specified permissions.
 * Usage: requireAnyPermission('TICKET_CREATE', 'USER_CREATE')
 */
function requireAnyPermission(...permissionCodes) {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      if (!userRole) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const hasPerm = await PermissionService.hasAnyPermission(userRole, permissionCodes);
      if (!hasPerm) {
        return res.status(403).json({
          error: 'Forbidden',
          required: permissionCodes,
          actualRole: userRole,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require the user to have ALL specified permissions.
 * Usage: requireAllPermissions('TICKET_UPDATE', 'TICKET_STATUS_CHANGE')
 */
function requireAllPermissions(...permissionCodes) {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      if (!userRole) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const hasPerms = await PermissionService.hasAllPermissions(userRole, permissionCodes);
      if (!hasPerms) {
        return res.status(403).json({
          error: 'Forbidden',
          required: permissionCodes,
          actualRole: userRole,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireAnyPermission, requireAllPermissions };
```

---

## Updated Route Guards

### Before (role-based):
```javascript
// api/users.js
router.post('/', requireRole('project_admin', 'member'), controller.createUser);
router.delete('/:id', requireRole('project_admin', 'super_admin'), controller.deleteUser);
```

### After (permission-based):
```javascript
// api/users.js
const { requireAnyPermission } = require('../middleware/permissions');

router.post('/', requireAnyPermission('USER_CREATE'), controller.createUser);
router.delete('/:id', requireAnyPermission('USER_DELETE'), controller.deleteUser);
```

### Permission-to-Route Mapping

| Route | Old Role Guard | New Permission Guard |
|-------|---------------|---------------------|
| `POST /api/users` | `project_admin, member` | `USER_CREATE` |
| `DELETE /api/users/:id` | `project_admin, super_admin` | `USER_DELETE` |
| `PATCH /api/users/:id/toggle-active` | `project_admin, super_admin` | `USER_TOGGLE_ACTIVE` |
| `GET /api/users/super-admin` | `super_admin` | `USER_VIEW_ALL` |
| `DELETE /projects/tickets/:ticketId` | `project_admin, member, user` | `TICKET_DELETE` |
| `DELETE /tickets/:ticketId` | `project_admin, member` | `TICKET_DELETE` |
| `POST /api/agents/create` | `project_admin, member` | `AGENT_CREATE` |
| `POST /api/agents/revoke/:id` | `project_admin` | `AGENT_REVOKE` |
| `DELETE /api/agents/:id` | `project_admin` | `AGENT_DELETE` |
| `POST /approvals/:id/approve` | `project_admin, member, super_admin` | `APPROVAL_APPROVE` |
| `POST /approvals/:id/reject` | `project_admin, member, super_admin` | `APPROVAL_REJECT` |
| `GET /api/approvals` | `super_admin` | `APPROVAL_VIEW` |

---

## Service-Level Permission Checks

### Before (inline role checks in TicketService.js):
```javascript
// TicketService.update()
if (
  user.role !== 'super_admin' &&
  user.role !== 'project_admin' &&
  user.role !== 'member' &&
  ticket.ownerId !== userId
) {
  throw new ForbiddenError('Unauthorized to edit this ticket');
}
```

### After (permission-based):
```javascript
// TicketService.update()
const canUpdate = await PermissionService.hasAnyPermission(user.role, [
  'TICKET_UPDATE',
]);
if (!canUpdate && ticket.ownerId !== userId) {
  throw new ForbiddenError('Unauthorized to edit this ticket');
}
```

**Note**: Ownership-based exceptions (e.g., "users can update their own tickets") remain as business logic. The permission check is the first gate — if the role doesn't have `TICKET_UPDATE`, no one can update. If the role does have it, ownership rules may still apply.

---

## Frontend Permission System

### Auth Store Extension

**File**: `frontend/src/stores/auth.js`

```javascript
// New: permission-based helpers (replaces role-based checks)
const hasPermission = (permissionCode) => {
  if (!user.value?.role) return false
  return rolePermissions.value.has(permissionCode)
}

const hasAnyPermission = (permissionCodes) => {
  if (!user.value?.role) return false
  return permissionCodes.some(code => rolePermissions.value.has(code))
}

// Load permissions for user's role from backend
const loadRolePermissions = async () => {
  if (!user.value?.role) return
  try {
    const resp = await api.get(`/api/permissions/${user.value.role}`)
    rolePermissions.value = new Set(resp.data)
  } catch {
    rolePermissions.value = new Set()
  }
}

// Legacy: keep role-based helpers for backward compatibility
const isProjectAdmin = () => hasRole('project_admin')
const isMember = () => hasRole('member')
// ... etc (deprecated, use hasPermission instead)
```

### API Endpoint for Permission Lookup

**File**: `backend/src/api/permissions.js` (new)

```javascript
const express = require('express');
const router = express.Router();
const PermissionService = require('../services/PermissionService');

// GET /api/permissions/:roleName → [permissionCodes]
router.get('/:roleName', async (req, res, next) => {
  try {
    const permissions = await PermissionService.resolvePermissions(req.params.roleName);
    res.json({ success: true, data: [...permissions] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

### Frontend Permission Checks

**Before** (`TicketBoard.vue`):
```javascript
const canCreate = computed(() => {
  const role = authStore.user.value?.role
  return ['project_admin', 'member', 'user', 'super_admin'].includes(role)
})
```

**After** (`TicketBoard.vue`):
```javascript
const canCreate = computed(() => {
  return authStore.hasPermission('TICKET_CREATE')
})
```

---

## Migration Strategy

### Phase 1: Database Schema (non-breaking)
1. Create `permissions`, `roles`, `role_permissions` tables
2. Seed data from existing roles
3. **No code changes** — existing `users.role` column untouched

### Phase 2: Backend Permission Service (non-breaking)
1. Create `PermissionService.js`
2. Create new `requireAnyPermission` / `requireAllPermissions` middleware
3. **Old `requireRole` middleware stays** — doesn't break anything

### Phase 3: Route Migration (breaking per-route)
1. Replace `requireRole('a', 'b')` with `requireAnyPermission('PERM_X')`
2. Each route migration is independent — can be tested per-route
3. Old `requireRole` still available as fallback

### Phase 4: Service-Level Migration (breaking per-service)
1. Replace inline `role ===` checks with `PermissionService.hasPermission()`
2. Each service file migrated independently

### Phase 5: Frontend Migration (breaking per-component)
1. Add permission lookup API endpoint
2. Extend auth store with `hasPermission()` helpers
3. Replace role-based computed properties with permission checks

### Phase 6: Cleanup (optional, later)
1. Remove old `requireRole` middleware
2. Remove legacy role checks from frontend
3. Remove uppercase role name dead code

---

## Architecture Decision: Why Not Replace `users.role` Entirely?

**Decision**: Keep `users.role` as a string column that references `roles.name`.

**Rationale**:
- Changing `users.role` from `VARCHAR` to `BIGINT` FK is a risky migration
- The string value IS the role name — no need for a join to resolve it
- The `role_permissions` table handles the mapping; `users.role` is just the lookup key
- If we later want per-user permissions (beyond role-based), we can add a `user_permissions` table without touching `users.role`

**Alternative considered**: Replace `users.role` with `role_id` (FK).
- **Rejected**: Requires migration of all user records, risks foreign key violations, no tangible benefit over string lookup.

---

## Architecture Decision: Why `requireAnyPermission` Instead of `requireAllPermissions`?

**Default**: `requireAnyPermission` (OR logic) — user needs at least one of the listed permissions.

**Exception**: `requireAllPermissions` (AND logic) — used when multiple distinct permissions are required for a single action (rare, but exists for high-privilege actions).

**Example**: Deleting a user might require both `USER_DELETE` AND `USER_READ` (read to verify, delete to remove). In practice, `USER_DELETE` alone should suffice — AND logic is available for edge cases.

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file (if a small model will execute this ticket)

---

*This document defines how the permission system will be built. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for the implementation plan.*
