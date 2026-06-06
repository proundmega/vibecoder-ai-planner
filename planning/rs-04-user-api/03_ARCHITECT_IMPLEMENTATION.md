# RS-4: User Management API

**Status**: completed
**Priority**: P1
**Effort**: Large
**Author**: Lead Architect
**Date created**: 2026-06-05
**Date completed**: 2026-06-06
**PR**: feature/role-system-overhaul
**Branch**: feature/role-system-overhaul

**Dependencies**: RS-3 (Auth middleware)

---

### a) Purpose

Create CRUD endpoints for user management with role-gated access. Admins manage their team, members manage AI agents, super_admins manage all users.

### b) Actions

1. Create `backend/src/api/users.js`:
   ```javascript
   const express = require('express');
   const router = express.Router();
   const { verifyToken, requireRole, requireActiveUser } = require('../middleware/auth');
   const UserService = require('../services/UserService');

   // List users (project_admin: own users, member: own users, super_admin: all users)
   router.get('/', verifyToken, requireActiveUser, async (req, res) => {
     const { role, search, page = 1, perPage = 20 } = req.query;
     const users = await UserService.listUsers(req.user.userId, req.user.role, { role, search, page, perPage });
     res.json({ users, pagination: { page, perPage, total: users.length } });
   });

   // Create user (project_admin: member/user, member: user only)
   router.post('/', verifyToken, requireRole('project_admin', 'member'), async (req, res) => {
     const { name, email, password, role } = req.body;
     const user = await UserService.createUser(name, email, password, role, req.user.userId);
     res.status(201).json(user);
   });

   // Update user (project_admin: all, member: user only)
   // Note: role is IMMUABLE — cannot be changed after assignment
   router.put('/:id', verifyToken, requireActiveUser, async (req, res) => {
     const { name, is_active } = req.body;
     const user = await UserService.updateUser(req.params.id, req.user.userId, { name, is_active });
     res.json(user);
   });

   // Deactivate/activate user
   router.patch('/:id/toggle-active', verifyToken, requireRole('project_admin', 'super_admin'), async (req, res) => {
     const user = await UserService.toggleUserActive(req.params.id, req.user.userId);
     res.json(user);
   });

   // Delete user
   router.delete('/:id', verifyToken, requireRole('project_admin', 'super_admin'), async (req, res) => {
     await UserService.deleteUser(req.params.id, req.user.userId);
     res.json({ message: 'User deleted' });
   });

   // Super admin: list ALL users (no project scoping)
   router.get('/super-admin', verifyToken, requireRole('super_admin'), async (req, res) => {
     const { search, role, is_active, page = 1, perPage = 50 } = req.query;
     const users = await UserService.listAllUsers({ search, role, is_active, page, perPage });
     res.json(users);
   });

   module.exports = router;
   ```
2. Update `backend/src/services/UserService.js` — add methods:
   - `listUsers(userId, userRole, filters)` — scoped by creator
   - `createUser(name, email, password, role, createdBy)` — with validation
   - `updateUser(userId, adminId, updates)` — name and is_active only (role is immutable)
   - `toggleUserActive(userId, adminId)` — activate/deactivate
   - `deleteUser(userId, adminId)` — HARD DELETE (permanent)
   - `listAllUsers(filters)` — super_admin only, no scoping
3. Update `backend/src/models/user.js` — add methods:
   - `findAll(filters)` — with role, search, pagination
   - `update(userId, updates)` — name and is_active only (role is immutable)
   - `toggleActive(userId)` — update is_active
   - `delete(userId)` — HARD DELETE (permanent removal)

### c) Dependencies
- RS-3 (Auth middleware)

### d) Risks/Edge Cases
- **Self-deletion**: Users can't delete their own account — validate in service
- **Password reset**: Admins can reset passwords for their users — add `resetPassword()` method
- **Search**: Full-text search on name/email — use `ILIKE` or PostgreSQL full-text search
- **Pagination**: Implement cursor-based or offset-based pagination for large datasets
- **Hard delete**: Permanent removal — ensure no foreign key references will break

### e) Testing
- **Unit tests**: `backend/src/__tests__/unit.test.js` — test `UserService` methods:
  - `createUser()` with valid role hierarchy → returns user
  - `createUser()` with invalid role (e.g., `project_admin` creating `super_admin`) → throws
  - `createUser()` with self-reference → throws
  - `listUsers()` scoped by creator → only returns users created by that creator
  - `listAllUsers()` for super_admin → returns all users
  - `updateUser()` name change → returns updated user
  - `toggleUserActive()` → toggles is_active
  - `deleteUser()` owner deleting own account → throws
  - `deleteUser()` admin deleting user → succeeds
  - `User.findAll()` with filters → returns paginated results
  - `User.update()` role field rejected → throws
  - `User.delete()` hard delete → removes from DB

### f) Notes
- Bash integration tests: `test_role_based_user_management()` verifies admin can create member/user roles, update names, toggle active/deactive, list users; verifies regular users get 403 on user creation; verifies member can create `user` role but not `member` role; verifies admin can delete users and super-admin endpoint requires `super_admin`.
