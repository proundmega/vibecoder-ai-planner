# 02_ARCHITECT_DESIGN.md — Frontend Logout Cleanup

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The `logout()` function in the auth store leaves `vibecode_permissions` in localStorage after logout. This causes stale permission data to persist, potentially confusing route guards and showing protected UI elements to logged-out users.

---

## Current State

### Auth Store Logout (`frontend/src/stores/auth.js:87-92`)
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

### localStorage Keys
| Key | Written By | Read By | Removed in logout |
|-----|-----------|---------|-------------------|
| `vibecode_token` | `login()`, `fetchToken()` | `api/client.js`, route guards | Yes ✓ |
| `vibecode_user` | `login()`, `fetchUser()` | Route guards, UI components | Yes ✓ |
| `vibecode_permissions` | `login()`, `fetchPermissions()` | Route guards | No ✗ |

### Gap Analysis
- `vibecode_permissions` is set during login and when permissions change
- It is read by route guards to check if the user has required roles
- It is NOT removed during logout
- After logout, a user could see protected UI elements (until the token check fails)
- Route guards may show inconsistent state (permissions present but token missing)

---

## Design

### Fix: Add Missing localStorage Cleanup

Add one line to `logout()`:
```javascript
const logout = () => {
  user.value = null
  token.value = ''
  permissions.value = []
  localStorage.removeItem('vibecode_user')
  localStorage.removeItem('vibecode_token')
  localStorage.removeItem('vibecode_permissions')  // NEW
}
```

This ensures all three localStorage keys are cleared, matching the three keys that are set during login.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/stores/auth.js` | MODIFY | Add `localStorage.removeItem('vibecode_permissions')` to `logout()` |

---

## Dependencies

- No new npm dependencies
- No backend changes

---

## Config / Environment Changes

- No new environment variables

---

## Security Considerations

- [x] No new authentication or authorization changes
- [x] This fix improves security by ensuring stale permissions are cleared

---

## Risks and Edge Cases

### Frontend Risks
- **[None expected]**: This is a one-line fix that adds missing cleanup logic. No behavioral changes beyond clearing the stale key.

### Edge Cases
- **[Concurrent logout]**: If the user clicks logout while a permissions fetch is in progress, the fetch may write to localStorage after logout. This is unlikely and not a security concern (the token is already cleared).

---

## Alternative Designs Considered

### Alternative 1: Use a single localStorage key for all auth data
- **Pros**: Simpler — one key to clear
- **Cons**: Breaking change; requires updating all consumers (route guards, api/client.js, UI components)
- **Decision**: Not worth the risk for a one-line fix. Keep the three-key approach.

### Alternative 2: Clear all localStorage on logout
- **Pros**: Ensures absolutely no stale data
- **Cons**: May clear non-auth localStorage data (e.g., UI preferences)
- **Decision**: Only clear the three known auth keys. Other localStorage data is not our concern.
