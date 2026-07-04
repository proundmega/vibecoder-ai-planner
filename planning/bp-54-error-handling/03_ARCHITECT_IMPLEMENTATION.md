# 03_ARCHITECT_IMPLEMENTATION.md — Error Handling Standardization

**Status**: planned
**Priority**: P2
**Effort**: Large
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Both

**Dependencies**: None

---

### a) Purpose

Standardize error handling across the entire codebase so that logs are reliable, API responses are predictable, and frontend errors are uniformly displayed.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

**Phase 1 — Backend Foundation**

1. **Create error classes** — `backend/src/errors/AppError.js`
   - Base `AppError`, subclasses: `NotFoundError`, `ValidationError`, `AuthError`, `ForbiddenError`, `ConflictError`, `RateLimitError`
   - *Depends on*: nothing

2. **Create response helpers** — `backend/src/utils/response.js`
   - `sendSuccess(res, data, status)`, `sendError(res, code, message, status)`
   - *Depends on*: nothing

3. **Update errorHandler middleware** — `backend/src/middleware/errorHandler.js`
   - Handle `AppError` subclasses; use `sendError`; standardize 500 format
   - Replace `console.error` with `logger.error`
   - *Depends on*: Step 1, Step 2

4. **Update validation middleware** — `backend/src/middleware/validate.js`
   - Throw `ValidationError` instead of raw error
   - *Depends on*: Step 1

5. **Update auth middleware** — `backend/src/middleware/auth.js`
   - Standardize 401/403/429 response shapes using `sendError`
   - Replace `console.warn`/`console.error` with `logger.*`
   - *Depends on*: Step 2, Step 3

6. **Update permissions middleware** — `backend/src/middleware/permissions.js`
   - Standardize 403 response shape
   - *Depends on*: Step 2

**Phase 2 — Backend Route Standardization**

7. **Standardize auth routes** — `backend/src/api/routes.js`
   - Rewrite register/login/me responses to use `sendSuccess`/`sendError`
   - Replace `console.error` with `logger.error`
   - *Depends on*: Step 2

8. **Standardize remaining route files** — `backend/src/api/v1/*.js`, `backend/src/api/agents.js`, `backend/src/api/approvals.js`
   - Use `sendSuccess`/`sendError` instead of inline `res.json()`
   - *Depends on*: Step 2

9. **Replace all remaining console.* calls** — across `backend/src/`
   - `backend/src/db.js`, `backend/src/services/*.js`
   - *Depends on*: nothing textual (can be done in parallel)

**Phase 3 — Frontend Standardization**

10. **Update API client** — `frontend/src/api/client.js`
    - Return `{ data, error }` from `apiFetch()`
    - Centralize error extraction from backend response
    - *Depends on*: Phase 2 (backend response shapes finalized)

11. **Standardize all API modules** — `frontend/src/api/*.js`
    - Remove per-module `.catch()` overrides
    - Return `{ data, error }` consistently
    - *Depends on*: Step 10

12. **Create `useAsyncState` composable** — `frontend/src/composables/useAsyncState.ts`
    - Loading/error/data reactive state
    - `execute(asyncFn)` wrapper with try/catch
    - *Depends on*: nothing

13. **Create `ErrorToast` component** — `frontend/src/components/ErrorToast.vue`
    - Auto-dismiss toast for API errors
    - Register globally or via provide/inject
    - *Depends on*: Step 11 (to consume the error shape)

14. **Update views** — `frontend/src/views/*.vue`
    - Replace ad-hoc error states with `useAsyncState`
    - Remove duplicate loading/error template branches
    - *Depends on*: Step 12, Step 13

---

### c) Per-File Action Plan

#### `backend/src/errors/AppError.js` (CREATE)
```javascript
class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AppError';
  }
}
class NotFoundError extends AppError { constructor(msg = 'Resource not found') { super('NOT_FOUND', msg, 404); } }
class ValidationError extends AppError { constructor(msg = 'Validation failed', details) { super('VALIDATION_ERROR', msg, 400); this.details = details; } }
class AuthError extends AppError { constructor(msg = 'Authentication failed') { super('AUTH_ERROR', msg, 401); } }
class ForbiddenError extends AppError { constructor(msg = 'Forbidden') { super('FORBIDDEN', msg, 403); } }
class ConflictError extends AppError { constructor(msg = 'Resource already exists') { super('CONFLICT', msg, 409); } }
class RateLimitError extends AppError { constructor(msg = 'Too many requests') { super('RATE_LIMITED', msg, 429); } }
module.exports = { AppError, NotFoundError, ValidationError, AuthError, ForbiddenError, ConflictError, RateLimitError };
```

#### `backend/src/utils/response.js` (CREATE)
```javascript
function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data, requestId: req.requestId });
}
function sendError(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message }, requestId: req.requestId });
}
function sendValidationError(res, message, details) {
  return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message, details }, requestId: req.requestId });
}
module.exports = { sendSuccess, sendError, sendValidationError };
```

#### `backend/src/middleware/errorHandler.js` (MODIFY)
- Replace `console.error` with `logger.error`
- Handle `err instanceof AppError` → `sendError(res, err.code, err.message, err.status)`
- Handle `err instanceof ValidationError` → `sendValidationError(res, err.message, err.details)`
- Fallthrough: `logger.error('Unhandled error', ...)` → `sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500)`

#### Auth response changes (`backend/src/api/routes.js`)
- Register success: `sendSuccess(res, { user: { id, email, role, name } }, 201)`
- Login success: `sendSuccess(res, { token, user: { id, email, role, name } })`
- Me success: `sendSuccess(res, { user: { id, email, role, name } })`
- All errors: `next(new AuthError('Invalid credentials'))` etc.

#### `frontend/src/api/client.js` (MODIFY)
```javascript
async function apiFetch(url, options = {}) {
  // ... existing auth token logic ...
  try {
    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { data: null, error: body.error || { code: 'UNKNOWN', message: `HTTP ${response.status}` } };
    }
    return { data: body.data !== undefined ? body.data : body, error: null };
  } catch (err) {
    return { data: null, error: { code: 'NETWORK_ERROR', message: err.message } };
  }
}
```

#### `frontend/src/composables/useAsyncState.ts` (CREATE)
```typescript
export function useAsyncState<T>() {
  const loading = ref(false);
  const error = ref<{ code: string; message: string } | null>(null);
  const data = ref<T | null>(null);

  async function execute(asyncFn: () => Promise<{ data: T | null; error: any }>) {
    loading.value = true;
    error.value = null;
    const result = await asyncFn();
    if (result.error) {
      error.value = result.error;
    } else {
      data.value = result.data;
    }
    loading.value = false;
  }

  return { loading, error, data, execute };
}
```

---

### d) Dependencies

- No new npm dependencies
- Backend response shape change must precede frontend API client update
- All changes are backward-compatible (old frontend still works with old backend; both pieces should be deployed together)

---

### e) Risks/Edge Cases

- **[Auth regression]**: Auth flow is the most sensitive. Test login, register, logout, and protected route access after backend + frontend changes.
- **[Silent errors become visible]**: Some errors currently swallowed by `.catch(() => null)` will now surface. This is good — but may uncover existing bugs.
- **[Error toast spam]**: If some endpoints regularly return errors (e.g., health check), the toast may fire continuously. Add route-based opt-out or dedup.

---

### f) Testing

#### Backend Unit Tests
- [ ] Test `AppError` subclasses — correct code, message, status
- [ ] Test `sendSuccess`/`sendError` helpers — correct response shape
- [ ] Test `errorHandler` — handles each AppError subclass, falls through for unknown errors
- [ ] Test auth routes — standard response shapes

#### Frontend Unit Tests
- [ ] Test `client.js` — `{ data, error }` shape, network error handling
- [ ] Test `useAsyncState` — loading/error/data state transitions
- [ ] Test `ErrorToast` — appears on error, auto-dismisses
- [ ] Test all API modules — no ad-hoc `.catch()`, consistent return shape

#### Integration Tests
- [ ] Full auth flow (register → login → me → logout) with standardized responses
- [ ] Permission check flow with standardized 403
- [ ] Rate limit flow with standardized 429

---

### g) Migration Notes

No database migrations. Backend response shape change should be deployed simultaneously with frontend to avoid contract mismatches.

---

### h) Files Changed

**Backend (CREATE):**
```
backend/src/errors/AppError.js        → CREATE (error class hierarchy)
backend/src/utils/response.js         → CREATE (response helpers)
```

**Backend (MODIFY):**
```
backend/src/middleware/errorHandler.js → MODIFY (AppError support, logger)
backend/src/middleware/validate.js     → MODIFY (ValidationError)
backend/src/middleware/auth.js         → MODIFY (standardized responses, logger)
backend/src/middleware/permissions.js  → MODIFY (standardized 403)
backend/src/api/routes.js              → MODIFY (auth response shapes, logger)
backend/src/api/v1/*.js                → MODIFY (sendSuccess/sendError)
backend/src/api/agents.js              → MODIFY (logger)
backend/src/api/approvals.js           → MODIFY (logger)
backend/src/db.js                      → MODIFY (logger)
backend/src/services/*.js              → MODIFY (logger where console.* exists)
```

**Frontend (CREATE):**
```
frontend/src/composables/useAsyncState.ts  → CREATE
frontend/src/components/ErrorToast.vue     → CREATE
```

**Frontend (MODIFY):**
```
frontend/src/api/client.js    → MODIFY ({ data, error } shape)
frontend/src/api/tickets.js   → MODIFY (consistent error handling)
frontend/src/api/providers.js → MODIFY (consistent error handling)
frontend/src/api/approvals.js → MODIFY (add catch)
frontend/src/api/memory.js    → MODIFY (fix error handling)
frontend/src/api/github.js    → MODIFY (fix error handling)
frontend/src/api/usage.js     → MODIFY (fix error handling)
frontend/src/api/projects.js  → MODIFY (fix error handling)
frontend/src/api/auth.js      → MODIFY (fix error handling)
frontend/src/views/*.vue      → MODIFY (useAsyncState, ErrorToast)
```

---

### i) Code Review Checklist

- [ ] All ~79 `console.*` calls replaced with `logger.*` — verified by `grep -r "console\.\(log\|warn\|error\)" backend/src/`
- [ ] Auth responses return `{ success: true, data: { ... } }` — verified by unit test
- [ ] Error responses return `{ success: false, error: { code, message } }` — verified by unit test
- [ ] Frontend `client.js` returns `{ data, error }` — all callers updated
- [ ] No pre-existing `.catch(() => null)` or `.catch(() => [])` remains in frontend API modules
- [ ] `ErrorToast` shows for API errors, auto-dismisses, deduplicates
- [ ] All tests pass

---

### j) Post-Deploy Verification

1. [ ] `npm test` — backend + frontend tests pass
2. [ ] `npm run lint` — no lint errors
3. [ ] `npm run typecheck` — no TS errors
4. [ ] `npm run build` — frontend builds
5. [ ] Register new user → success response has `success: true, data: { user: {...} }`
6. [ ] Login with bad password → error has `success: false, error: { code: 'AUTH_ERROR', message: '...' }`
7. [ ] Access protected route without token → `{ code: 'AUTH_ERROR' }`
8. [ ] Access forbidden route → `{ code: 'FORBIDDEN' }`
9. [ ] Frontend shows error toast for API errors
10. [ ] `grep -r "console\.\(log\|warn\|error\)" backend/src/` returns 0 results (except migrations/apply.js which is standalone)
