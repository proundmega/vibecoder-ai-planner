# 01_ARCHITECT_REQUIREMENT.md — Prevent Self-Toggle User Active

**Status**: completed
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Users must NOT be able to activate or deactivate their own account through the UI. This prevents accidental self-lockout where a user deactivates themselves and loses access to the system.

---

## Scope

- Frontend: Hide toggle button when viewing own profile
- Backend: Validation already exists in `UserService.toggleUserActive()` (throws `ValidationError` if `userId === adminId`)
- Tests: Backend controller tests + frontend Cypress component tests

---

## Testing Checklist (MANDATORY)

- [x] **Happy path**: Toggle another user's active status works
- [x] **Self-toggle rejection (backend)**: `UserService.toggleUserActive(userId, userId)` throws `ValidationError`
- [x] **Self-toggle rejection (frontend)**: Toggle button hidden when `user.id === authStore.user.value?.id`
- [x] **Role validation**: Only users with `USER_TOGGLE_ACTIVE` permission see the button
- [x] **Edge cases**: Current user in user list, toggle button not rendered for self
- [x] **Authorization**: Permission middleware still works (`requireAnyPermission('USER_TOGGLE_ACTIVE')`)

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no unused vars, no errors
- `npm run typecheck` — frontend typecheck must pass
- Cypress component tests must pass

---

## Anti-Patterns to Avoid

- ❌ Testing implementation details (exact CSS class) — test behavior instead
- ❌ Tests that depend on execution order — each test must be independent
- ❌ Skipping tests with `test.skip`
- ❌ Testing multiple things in one test — one assertion per concept
- ❌ Real DB calls in unit tests — always mock
- ❌ Merging code without tests

---

## Code Change Requirements

1. Write unit tests before or alongside the implementation
2. Write integration tests covering the full request lifecycle
3. Run `npm test` — must pass
4. Pass `npm run lint` with zero errors
5. Update planning docs with ARCHITECT templates
