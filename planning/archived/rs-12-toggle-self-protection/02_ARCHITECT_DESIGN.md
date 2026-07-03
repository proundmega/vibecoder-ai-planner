# 02_ARCHITECT_DESIGN.md — Prevent Self-Toggle User Active

**Status**: completed
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

A user with `USER_TOGGLE_ACTIVE` permission (project_admin or super_admin) can accidentally deactivate their own account by clicking the toggle button in the user management UI. Once deactivated, they lose access to the system and require another admin (or DB access) to reactivate them.

---

## Current State

### Backend
- `UserService.toggleUserActive(userId, adminId)` already validates self-toggle at line 220-222:
  ```javascript
  if (userId === adminId) {
    throw new ValidationError('Cannot toggle your own account');
  }
  ```
- This throws an error that gets passed to `next(error)` in the controller
- The error is caught by the global error handler and returned as a 400 response

### Frontend
- `UserManagement.vue` line 180: `v-if="canToggleActive"` — shows button to anyone with permission
- `SuperAdminUsers.vue` line 141: `v-if="user.role !== 'super_admin'"` — shows button to everyone except super admins
- Neither checks if the user is viewing their own profile
- `handleToggleActive()` uses native `confirm()` dialog but has no pre-check

### Test Coverage
- Backend: `role-system.test.js` has 3 tests for `toggleUserActive()` including self-toggle rejection
- Backend controller: `userController.test.js` added with 4 tests (success, 404, self-toggle error, other error)
- Frontend: No Cypress test for toggle button visibility

---

## Design

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Frontend (UserManagement.vue)** | Hide toggle button when `user.id === authStore.user.value?.id` |
| **Frontend (SuperAdminUsers.vue)** | Hide toggle button when `user.id === authStore.user.value?.id` |
| **Backend (UserService)** | Already validates — no changes needed |
| **Backend (userController)** | Already handles error via `next(error)` — no changes needed |
| **Tests** | Add controller tests + Cypress component test |

### Frontend Changes

**UserManagement.vue** — Add self-check to button visibility:
```html
<button
  v-if="canToggleActive && user.id !== authStore.user.value?.id"
  @click="handleToggleActive(user)"
  ...
>
```

**SuperAdminUsers.vue** — Add self-check to button visibility:
```html
<button
  v-if="user.role !== 'super_admin' && !isOwnProfile(user)"
  @click="handleToggleActive(user)"
  ...
>
```
Where `isOwnProfile(user)` is a helper function:
```javascript
const authStore = useAuthStore()
const isOwnProfile = (user) => user.id === authStore.user.value?.id
```

### Defense in Depth

Two layers protect against self-toggle:
1. **Frontend**: Button hidden — prevents accidental clicks
2. **Backend**: Validation throws error — prevents API-level bypass (e.g., curl, direct API calls)

This is intentional: frontend is UX convenience, backend is security guarantee.

---

## Test Design

### Backend Controller Tests (`userController.test.js`)
- Happy path: toggle another user → returns `{ success, data }`
- 404: user not found → returns 404 with error wrapper
- Self-toggle: service throws → passes error to `next()`
- Other error: service throws → passes error to `next()`

### Frontend Cypress Tests (`UserManagement.cy.ts`)
- Current user in list → toggle button NOT rendered for self
- Other user in list → toggle button rendered
- Only 1 toggle button visible (for non-self users)

---

## Dependencies

- `UserService.toggleUserActive()` — existing validation (no changes)
- `authStore.user` — ref containing current user data
- `USER_TOGGLE_ACTIVE` permission — already granted to project_admin and super_admin

---

## Risks/Edge Cases

- **[authStore.user.value is null]**: If user not logged in, `authStore.user.value` is null — optional chaining (`?.id`) prevents crash
- **[ID type mismatch]**: If IDs are string vs number, `===` comparison fails — use loose comparison `!=` if needed (current IDs are strings from JWT, so `===` works)
- **[SuperAdminUsers.vue]**: Super admins can view their own profile — toggle button should be hidden for self even if not super_admin role
- **[API bypass]**: Someone could use curl to call the API directly — backend validation handles this

---

## Migration Notes

No database changes required. No API contract changes. No breaking changes.

---

*This document defines the design for preventing self-toggle. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
