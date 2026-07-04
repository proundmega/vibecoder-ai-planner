# 01_ARCHITECT_REQUIREMENT.md — Frontend Logout Cleanup

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P2
**Effort**: Small

---

## Requirement

Fix the `logout()` function in the auth store to clear all three localStorage keys. Currently, `logout()` only removes `vibecode_token` and `vibecode_user` but leaves `vibecode_permissions` in localStorage, causing stale permission data to persist after logout.

**Problem**: `frontend/src/stores/auth.js:87-92`:
```javascript
const logout = () => {
  user.value = null
  token.value = ''
  permissions.value = []
  localStorage.removeItem('vibecode_user')
  localStorage.removeItem('vibecode_token')
  // MISSING: localStorage.removeItem('vibecode_permissions')
}
```

Three localStorage keys are used by the auth system:
1. `vibecode_token` — JWT token (removed ✓)
2. `vibecode_user` — user object (removed ✓)
3. `vibecode_permissions` — user permissions (NOT removed ✗)

The route guards in `frontend/src/router/index.ts` read `localStorage` directly, including `vibecode_permissions`. After logout, the permissions key remains, which could:
- Cause route guards to think the user is still authenticated
- Show protected UI elements to logged-out users (until token check fails)
- Cause inconsistent state between the auth store (empty) and localStorage (stale data)

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Frontend Auth Check
- [x] Auth store exists: `frontend/src/stores/auth.js` — singleton Pinia store
- [x] `logout()` function: removes `vibecode_token` and `vibecode_user` only
- [x] `vibecode_permissions` is set by `login()` and `fetchPermissions()`
- [x] Route guards read from localStorage directly: `localStorage.getItem('vibecode_token')`
- [x] `api/client.js` reads token from Pinia store: `useAuthStore().token.value`

### Key Insight
This is FRONTEND-ONLY. The fix is a one-line addition to the logout function.

---

## Scope

### In Scope
- Add `localStorage.removeItem('vibecode_permissions')` to `logout()` in `stores/auth.js`
- Verify route guards work correctly after logout
- Verify re-login works correctly after logout

### Out of Scope
- Changing the auth store to use `defineStore()` (covered by bp-57)
- Adding TypeScript types to the auth store (covered by bp-57)
- Changing route guard logic (guards already read localStorage correctly)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/stores/auth.js` | MODIFY | Add `localStorage.removeItem('vibecode_permissions')` to `logout()` |
| `frontend/src/router/index.ts` | NONE | Guards already read localStorage correctly |
| `frontend/src/api/client.js` | NONE | Reads token from auth store, which is reset on logout |

---

## Known Unknowns

1. **[Other consumers of vibecode_permissions]**: Is `vibecode_permissions` read anywhere else besides route guards and the auth store? — Need to verify with grep.

---

## Important Design Decisions

1. **One-line fix**: This is a minimal change — add one `localStorage.removeItem()` call. No architectural changes needed.

---

## Acceptance Criteria

1. [ ] `logout()` removes `vibecode_token`, `vibecode_user`, AND `vibecode_permissions`
2. [ ] After logout, `localStorage.getItem('vibecode_permissions')` returns `null`
3. [ ] Route guards redirect to login after logout
4. [ ] Re-login after logout works correctly (fresh permissions fetched)
5. [ ] No regression in auth flow (login, register, protected routes)

---

## Out of Scope

- Changing the auth store to use `defineStore()` (covered by bp-57)
- Adding TypeScript types to the auth store (covered by bp-57)
- Changing route guard logic

---

## Security Considerations

- [x] Authentication required: N/A — this is a logout fix
- [x] No sensitive data handling changes — permissions are already in localStorage

---

## Testing Checklist

### Frontend Tests
- [ ] Unit test: `logout()` clears all three localStorage keys
- [ ] E2E test: logout → redirect to login → re-login works
- [ ] Verify route guards block access after logout

### CI Requirements
- [ ] `npm test -- --run` — frontend tests pass
- [ ] `npm run typecheck` — no TS errors
- [ ] `npm run lint` — no lint errors
