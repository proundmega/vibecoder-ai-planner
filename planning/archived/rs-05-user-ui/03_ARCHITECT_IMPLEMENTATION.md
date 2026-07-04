# RS-5: User Management UI — Project Admin & Member Views

**Status**: planned
**Priority**: P2
**Effort**: Large
**Dependencies**: RS-4 (User Management API)

---

### a) Purpose

Create user management screens for project_admin and member roles. Admin sees all team users, member sees only users they created. Both use modal-based CRUD.

### b) Actions

1. Create `frontend/src/views/UserManagement.vue`:
   - Header with "Manage Users" title
   - Role filter dropdown (all roles, project_admin, member, user)
   - Search input (name/email)
   - "Create User" button (only visible for project_admin/member)
   - User table with columns: Name, Email, Role, Created By, Status (Active/Deactivated), Actions
   - Actions per row: Edit, Delete (project_admin only), Toggle Active (project_admin only)
2. Create `frontend/src/views/SuperAdminUsers.vue`:
   - Separate view accessible only to super_admin role
   - Full user list (no project scoping)
   - Search/filter by role, status
   - Activate/Deactivate buttons
   - No create/delete (super_admins don't create users, they're created manually)
3. Create `frontend/src/components/UserModal.vue`:
   - Modal for create/edit user
   - Create fields: Name, Email, Password, Role (dropdown)
   - Edit fields: Name only (role is immutable, cannot be changed)
   - Role options depend on creator's role:
     - project_admin: member, user
     - member: user only
   - "Created By" field: mandatory for member/user roles, shows current user for self-registration
4. Update `frontend/src/router/index.ts`:
   ```typescript
   {
     path: '/users',
     name: 'UserManagement',
     component: () => import('../views/UserManagement.vue'),
     meta: { requiresAuth: true, allowedRoles: ['project_admin', 'member'] },
   },
   {
     path: '/super-admin/users',
     name: 'SuperAdminUsers',
     component: () => import('../views/SuperAdminUsers.vue'),
     meta: { requiresAuth: true, allowedRoles: ['super_admin'] },
   },
   ```
5. Update `frontend/src/api/users.js` — add methods:
   - `listUsers(filters)`
   - `createUser(data)`
   - `updateUser(id, data)`
   - `toggleUserActive(id)`
   - `deleteUser(id)`
   - `listAllUsers(filters)` (super_admin only)
6. Update router guard in `frontend/src/router/index.ts`:
   ```typescript
   // Check role-based access
   if (to.meta.allowedRoles && to.meta.allowedRoles.length > 0) {
     const user = JSON.parse(localStorage.getItem('vibecode_user') || '{}');
     if (!to.meta.allowedRoles.includes(user.role)) {
       next({ name: 'Dashboard' }); // or 403 page
       return;
     }
   }
   ```

### c) Dependencies
- RS-4 (User Management API)

### d) Risks/Edge Cases
- **Role display**: Show human-readable roles ("Project Admin", "Member", "AI Agent")
- **Immutable role**: Role cannot be changed after account creation — clearly communicate this to admins
- **Created By**: Show "Self-registered" for NULL user_created_by
- **Password**: Don't show password in list, only in create/edit modal
- **Confirmation**: Delete and toggle-active need confirmation dialogs
- **Loading states**: Show skeletons/spinners during API calls
- **Error handling**: Show toast notifications for success/error

### e) Testing
- **Component tests**: `UserModal.vue` — role selection options depend on creator role
  - `project_admin` → sees "member" and "user" options
  - `member` → sees only "user" option
  - `user` → no role selection (cannot create users)
- **E2E tests**: Role-gated navigation
  - `project_admin` can access `/users` → 200, "Manage Users" visible
  - `member` can access `/users` → 200, "Manage Users" visible
  - `user` role cannot access `/users` → redirects to `/dashboard`
  - `super_admin` can access `/super-admin/users` → 200
  - Non-super-admin cannot access `/super-admin/users` → redirects

### f) Notes
- **Known bugs to fix before implementing**: `authStore.user` is a `ref` — must use `authStore.user.value` in script code (see AGENTS.md).
