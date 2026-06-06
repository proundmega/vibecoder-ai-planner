# RS-3: Auth Middleware — Role-Based Access Control

**Status**: completed
**Priority**: P1
**Effort**: Medium
**Author**: Lead Architect
**Date created**: 2026-06-05
**Date completed**: 2026-06-06
**PR**: feature/role-system-overhaul
**Branch**: feature/role-system-overhaul

**Dependencies**: RS-2 (AuthService overhaul)

---

### a) Purpose

Implement role-based access control middleware to gate endpoints by role. This prevents unauthorized access to sensitive operations (AI key management, user creation, etc.).

### b) Actions

1. Create `backend/src/middleware/roleAuth.js`:
   ```javascript
   function requireRole(...allowedRoles) {
     return (req, res, next) => {
       if (!req.user || !req.user.role) {
         return res.status(401).json({ error: 'Authentication required' });
       }

       if (!allowedRoles.includes(req.user.role)) {
         return res.status(403).json({
           error: 'Forbidden',
           required: allowedRoles,
           actual: req.user.role
         });
       }

       next();
     };
   }

   function requireActiveUser(req, res, next) {
     if (!req.user || !req.user.isActive) {
       return res.status(403).json({ error: 'Account deactivated' });
     }
     next();
   }

   module.exports = { requireRole, requireActiveUser };
   ```
2. Update `backend/src/middleware/auth.js` — add `requireRole` and `requireActiveUser` exports
3. Apply role guards to routes:
   - `POST /api/users` (create user): `requireRole('project_admin', 'member')`
   - `PUT /api/users/:id/role`: `requireRole('project_admin')`
   - `DELETE /api/users/:id`: `requireRole('project_admin', 'super_admin')`
   - `GET /api/users/super-admin`: `requireRole('super_admin')`
   - `POST /api/agents/create`: `requireRole('project_admin', 'member')`
   - `DELETE /api/agents/:id`: `requireRole('project_admin')`
   - `DELETE /api/tickets/:id`: `requireRole('project_admin', 'member')` (user role blocked)
4. Update `UserService.authenticate()` — check `is_active` before returning session:
   ```javascript
   async authenticate(email, password) {
     const user = await User.findByEmail(email);
     if (!user) throw new Error('Invalid credentials');

     const isValid = await bcrypt.compare(password, user.passwordHash);
     if (!isValid) throw new Error('Invalid credentials');

     if (!user.isActive) {
       throw new Error('Account deactivated. Contact support.');
     }

     // ... token generation
   }
   ```

### c) Dependencies
- RS-2 (AuthService overhaul)

### d) Risks/Edge Cases
- **Role hierarchy**: `super_admin` > `project_admin` > `member` > `user`
- **Token payload**: JWT must include `role` and `isActive` claims
- **Backward compatibility**: Existing tokens without `role` should be handled gracefully
- **Agent auth**: AI agents (`user` role) bypass role checks on their own tickets

### e) Testing
- **Unit tests**: `backend/src/middleware/roleAuth.test.js` — test `requireRole()` and `requireActiveUser()`:
  - `requireRole('project_admin')` with `project_admin` user → calls `next()`
  - `requireRole('project_admin')` with `member` user → returns 403
  - `requireRole('project_admin', 'member')` with `member` user → calls `next()`
  - `requireRole()` with no user → returns 401
  - `requireActiveUser()` with active user → calls `next()`
  - `requireActiveUser()` with inactive user → returns 403
  - `UserService.authenticate()` with inactive user → throws error

### f) Notes
- `requireActiveUser` middleware refactored to use synchronous `.then()` promise chain.
- `afterEach` in `role-system.test.js` clears `approval_requests`, `tickets`, `projects`, `users` tables.
- Fixed `deactivated user cannot login` and `deactivated user cannot access protected endpoints` tests to handle deactivated login failures correctly.
- Fixed `requireActiveUser blocks deactivated users on users endpoint` test to use registration token directly.
