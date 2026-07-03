# RS-9: Frontend Router & Navigation Updates

**Status**: planned
**Priority**: P3
**Effort**: Small
**Dependencies**: RS-5 (User Management UI)

---

### a) Purpose

Update frontend routing to support new user management views and role-based access control.

### b) Actions

1. Update `frontend/src/router/index.ts`:
   ```typescript
   // Add new routes
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
2. Update router guard to check `allowedRoles`:
   ```typescript
   router.beforeEach((to, _from, next) => {
     if (to.matched.some(record => record.meta.requiresAuth)) {
       if (!isAuthenticated()) {
         next({ name: 'Login', query: { redirect: to.fullPath } });
         return;
       }

       const user = JSON.parse(localStorage.getItem('vibecode_user') || '{}');
       if (to.meta.allowedRoles && to.meta.allowedRoles.length > 0) {
         if (!to.meta.allowedRoles.includes(user.role)) {
           next({ name: 'Dashboard' }); // or 403 page
           return;
         }
       }
     }
     next();
   });
   ```
3. Update `frontend/src/stores/auth.js`:
   - Add `role` to user object (already exists, verify)
   - Add `isActive` to user object
   - Add `hasRole(role)` helper method
   - Add `canAccess(allowedRoles)` helper method
4. Update navigation menu/sidebar:
   - Show "Users" link for project_admin and member
   - Show "Super Admin" link for super_admin only
   - Hide links based on role

### c) Dependencies
- RS-5 (User Management UI)

### d) Risks/Edge Cases
- **Route guards**: Must check role before rendering component (prevent flash of unauthorized content)
- **LocalStorage sync**: Ensure `vibecode_user` includes role and isActive
- **403 page**: Create a simple "Access Denied" page for unauthorized route access
- **Navigation items**: Dynamically show/hide based on role

### e) Testing
- **E2E tests**: Role-gated navigation
  - `project_admin` can access `/users` → 200, "Manage Users" visible
  - `member` can access `/users` → 200, "Manage Users" visible
  - `user` role cannot access `/users` → redirects to `/dashboard`
  - `super_admin` can access `/super-admin/users` → 200
  - Non-super-admin cannot access `/super-admin/users` → redirects

### f) Notes
- **Known bugs to fix before implementing**: `route.params.projectId` is always undefined — router param is `id` (from `projects/:id/ai`), not `projectId` (see AGENTS.md).
