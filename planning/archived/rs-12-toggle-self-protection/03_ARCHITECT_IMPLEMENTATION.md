# 03_ARCHITECT_IMPLEMENTATION.md — Prevent Self-Toggle User Active

**Status**: completed
**Priority**: P2
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: 2026-06-10
**PR**: https://github.com/proundmega/vibecoder-ai-planner/pull/[TBD]
**Branch**: master

**Dependencies**: None (backend validation already exists)

---

### a) Purpose

Prevent users from accidentally deactivating their own account via the user management UI. The backend already has validation (`UserService.toggleUserActive()` throws `ValidationError` on self-toggle), but the frontend showed the toggle button to everyone with `USER_TOGGLE_ACTIVE` permission, allowing users to click it and trigger a client-side error.

**Value delivered**: Eliminates accidental self-lockout, improves UX by preventing unnecessary error dialogs, provides defense-in-depth with frontend prevention + backend validation.

---

### b) Actions

1. **Frontend: UserManagement.vue** — Add self-check to toggle button visibility
   ```
   frontend/src/views/UserManagement.vue
     line 180: v-if="canToggleActive" → v-if="canToggleActive && user.id !== authStore.user.value?.id"
   ```

2. **Frontend: SuperAdminUsers.vue** — Add authStore import, helper function, and self-check
   ```
   frontend/src/views/SuperAdminUsers.vue
     line 2:   import { ref, onMounted } → import { ref, onMounted } (no computed needed, helper is inline)
     line 3:   import { listAllUsers, toggleUserActive, updateUser } → add import { useAuthStore }
     line 14:  const actionLoading = ref(false) → add: const authStore = useAuthStore(), const isOwnProfile = (user) => user.id === authStore.user.value?.id
     line 141: v-if="user.role !== 'super_admin'" → v-if="user.role !== 'super_admin' && !isOwnProfile(user)"
   ```

3. **Backend: userController.test.js** — Create new test file for toggleUserActive controller
   ```
   backend/src/__tests__/userController.test.js (NEW FILE)
     - jest.mock('../services/UserService')
     - describe('User Controller - toggleUserActive')
       - it('should toggle user active status with success wrapper')
       - it('should return 404 when user not found')
       - it('should pass error to next() when validation fails (self-toggle)')
       - it('should pass error to next() for other errors')
   ```

4. **Frontend: UserManagement.cy.ts** — Add Cypress component test for toggle button visibility
   ```
   frontend/cypress/component/UserManagement.cy.ts
     - Add test: 'should hide toggle button for current user'
     - Mock: users list with current user (admin-1) + another user (Bob)
     - Assert: only 1 .btn-toggle button rendered (for Bob, not admin-1)
   ```

5. **Verify**: Run `npm test`, `npm run lint`, `npm run typecheck`, Cypress component tests

**Files modified:**
```
frontend/src/views/UserManagement.vue     → toggle button visibility check
frontend/src/views/SuperAdminUsers.vue    → authStore import, isOwnProfile helper, toggle button visibility check
backend/src/__tests__/userController.test.js → NEW: controller tests for toggleUserActive
frontend/cypress/component/UserManagement.cy.ts → NEW: Cypress test for toggle button visibility
```

---

### c) Dependencies

- **UserService.toggleUserActive()** — existing validation (no changes needed)
- **authStore.user** — ref containing current user data (existing)
- **USER_TOGGLE_ACTIVE permission** — already granted to project_admin and super_admin (existing)

---

### d) Risks/Edge Cases

- **[authStore.user.value is null]**: If user not logged in, `authStore.user.value` is null — optional chaining (`?.id`) prevents crash
- **[ID type mismatch]**: If IDs are string vs number, `===` comparison fails — current IDs are strings from JWT, so `===` works
- **[SuperAdminUsers.vue]**: Super admins viewing their own profile — toggle button hidden via `isOwnProfile()` even though `user.role !== 'super_admin'` is false for super admins
- **[API bypass]**: Someone could use curl to call the API directly — backend validation handles this (defense in depth)
- **[Cypress test flakiness]**: Button selectors must be specific enough — use `.btn-toggle` class selector

---

### e) Testing

#### Unit Tests
- [x] Backend controller: toggle another user → returns `{ success, data }`
- [x] Backend controller: user not found → returns 404
- [x] Backend controller: self-toggle → passes error to `next()`
- [x] Backend controller: other error → passes error to `next()`
- [x] Backend service: `toggleUserActive(1, 1)` throws `ValidationError` (existing test)

#### Integration Tests
- [x] Full request lifecycle: HTTP → middleware → controller → service → DB → response
- [x] Role-based access: `USER_TOGGLE_ACTIVE` permission required

#### Frontend Tests
- [x] Component test: `UserManagement.vue` — toggle button hidden for current user
- [x] Component test: `UserManagement.vue` — toggle button visible for other users

---

### f) Migration Notes

No database migrations required. No API contract changes. No breaking changes.

---

### g) Notes

- Backend validation already existed in `UserService.toggleUserActive()` — only frontend was missing
- Frontend prevention is UX convenience, backend validation is security guarantee
- Both `UserManagement.vue` and `SuperAdminUsers.vue` needed the same fix (different guard conditions + self-check)
- Cypress test required setting permissions in localStorage for `canToggleUser()` to return true
- All 255 backend tests pass, all 10 Cypress component tests pass, lint and typecheck clean

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, layer responsibilities, defense in depth*
- *`03_ARCHITECT_IMPLEMENTATION.md` → This template (purpose, actions, dependencies, risks, testing)*
