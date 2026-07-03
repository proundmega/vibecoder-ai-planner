# 03_ARCHITECT_IMPLEMENTATION.md — Frontend Logout Cleanup

**Status**: planned
**Priority**: P2
**Effort**: Small
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Fix the `logout()` function in the auth store to clear all three localStorage keys (`vibecode_token`, `vibecode_user`, `vibecode_permissions`), preventing stale permission data from persisting after logout.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

1. **Add missing localStorage cleanup** — `frontend/src/stores/auth.js`
   - Add `localStorage.removeItem('vibecode_permissions')` to `logout()`
   - *Depends on*: nothing

2. **Verify the fix** — manual testing
   - Login → verify all three keys are set
   - Logout → verify all three keys are cleared
   - Verify route guards redirect to login
   - Re-login → verify fresh permissions are fetched
   - *Depends on*: Step 1

---

### c) Per-File Action Plan

#### `frontend/src/stores/auth.js` (MODIFY)
```diff
  const logout = () => {
    user.value = null
    token.value = ''
    permissions.value = []
    localStorage.removeItem('vibecode_user')
    localStorage.removeItem('vibecode_token')
+   localStorage.removeItem('vibecode_permissions')
  }
```

---

### d) Dependencies

- No new npm dependencies

---

### e) Risks/Edge Cases

- **[None expected]**: This is a one-line fix that adds missing cleanup logic.

---

### f) Testing

#### Frontend Unit Tests
- [ ] Test: `logout()` clears `vibecode_token`, `vibecode_user`, AND `vibecode_permissions`
- [ ] Test: After logout, `localStorage.getItem('vibecode_permissions')` returns `null`

#### Frontend E2E Tests
- [ ] Logout → redirect to login page
- [ ] Re-login after logout → fresh permissions fetched, routes work

#### CI Requirements
- [ ] `npm test -- --run` — frontend tests pass
- [ ] `npm run typecheck` — no TS errors
- [ ] `npm run lint` — no lint errors

---

### g) Migration Notes

No database migrations. No backend changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/stores/auth.js    → MODIFY (add localStorage.removeItem('vibecode_permissions'))
```

---

### i) Code Review Checklist

- [ ] `logout()` removes all three localStorage keys
- [ ] Route guards redirect to login after logout
- [ ] Re-login after logout works correctly
- [ ] No regression in auth flow

---

### j) Post-Deploy Verification

1. [ ] Login → verify `vibecode_token`, `vibecode_user`, `vibecode_permissions` are set
2. [ ] Logout → verify all three keys are cleared
3. [ ] Navigate to protected route → redirect to login
4. [ ] Re-login → verify fresh permissions are fetched
5. [ ] `npm test -- --run` — frontend tests pass
6. [ ] `npm run lint` — no lint errors
