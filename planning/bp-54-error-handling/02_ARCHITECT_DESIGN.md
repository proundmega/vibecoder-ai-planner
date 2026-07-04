# 02_ARCHITECT_DESIGN.md — Error Handling Standardization

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Both
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Three systemic error handling problems make the codebase harder to debug and maintain:
1. Mixed `console.*`/`logger.*` usage makes production log analysis unreliable
2. Inconsistent API response shapes force frontend to special-case auth endpoints
3. Inconsistent error swallowing in API modules makes it impossible to distinguish "no data" from "request failed"

---

## Current State

### Backend Console vs Logger

~79 `console.*` calls across backend/src/:
- `console.error` in `errorHandler.js`, `auth.js`, `routes.js`, `api/agents.js`, `api/approvals.js`, `db.js`, `services/*.js`
- `console.log` in `migrations/apply.js`, `api/routes.js`
- `console.warn` occasionally

The Winston logger (`utils/logger.js`) has: levels (error/warn/info/debug), JSON formatting, request ID injection, and sensitive data masking.

### Auth Response Shapes

```javascript
// POST /api/auth/register (routes.js:189)
{ ...result, message: 'Registration successful' }
// POST /api/auth/login (routes.js:245)
{ message: 'Login successful', ...result }
// GET /api/auth/me (routes.js:280)
{ user: {...}, authenticated: true }
// Errors
{ error: error.message }
```

### Documented Convention (from AGENTS.md)
```javascript
{ success: true, data: ... }
{ success: false, error: { code, message } }
```

### Frontend API Module Patterns

| Module | List ops | Single ops | Mutations |
|--------|----------|------------|-----------|
| `tickets.js` | `.catch(() => [])` | `.catch(() => null)` | `.catch(() => null)` |
| `providers.js` | `.catch(() => [])` | `.catch(() => null)` | Some throw |
| `approvals.js` | No catch | N/A | No catch |
| `auth.js` | N/A | No catch | No catch |
| `projects.js` | `.catch(() => [])` | `.catch(() => null)` | `.catch(() => null)` |
| `memory.js` | `.catch(() => [])` | `.catch(() => null)` | No catch |
| `usage.js` | `.catch(() => [])` | N/A | N/A |

### Gap Analysis
- Backend: inconsistent log method usage, inconsistent response shapes
- Frontend: inconsistent error handling per module, no shared error display pattern, some errors silently swallowed

---

## Design

### Option A: Incremental Standardization (Recommended)

Phase 1: Backend — establish the contract. Phase 2: Frontend — consume it consistently. Each step is independently deployable.

#### Phase 1: Backend

**1. Add `sendSuccess` and `sendError` helper functions**

```javascript
// backend/src/utils/response.js
function sendSuccess(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    requestId: res.requestId,
  });
}

function sendError(res, code, message, status = 400) {
  return res.status(status).json({
    success: false,
    error: { code, message },
    requestId: res.requestId,
  });
}
```

**2. Add `AppError` class hierarchy**

```javascript
// backend/src/errors/AppError.js
class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AppError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super('VALIDATION_ERROR', message, 400);
    this.details = details;
  }
}
// ... AuthError (401), ForbiddenError (403), ConflictError (409), RateLimitError (429)
```

**3. Update errorHandler middleware**

```javascript
// backend/src/middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return sendError(res, err.code, err.message, err.status);
  }
  if (err instanceof ValidationError) {
    return sendError(res, 'VALIDATION_ERROR', err.message, 400);
  }
  // Unexpected errors
  logger.error('Unhandled error', { error: err.message, stack: err.stack, requestId: req.id });
  return sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
}
```

**4. Standardize auth responses**

- `/auth/register`: `sendSuccess(res, { user: { id, email, role, name } }, 201)`
- `/auth/login`: `sendSuccess(res, { token, user: { id, email, role, name } })`
- `/auth/me`: `sendSuccess(res, { user: { id, email, role, name } })`
- Errors: use `AppError` subclasses, caught by errorHandler

**5. Replace all `console.*` with `logger.*`**

Target files (representative):
- `backend/src/db.js:13` — `console.error` → `logger.error`
- `backend/src/middleware/errorHandler.js:5-7` — `console.error` → `logger.error`
- `backend/src/middleware/auth.js:66,132` — `console.warn` → `logger.warn`
- `backend/src/api/routes.js:191,249,282` — `console.error` → `logger.error`
- `backend/src/api/agents.js:55,84,111,138,196,232` — `console.*` → `logger.*`
- `backend/src/api/approvals.js:34,67,87,112,139,166` — `console.*` → `logger.*`

#### Phase 2: Frontend

**1. Update `api/client.js` to return `{ data, error }`**

```javascript
async function apiFetch(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, headers });
    const body = await response.json();
    if (!response.ok) {
      return { data: null, error: body.error || { code: 'UNKNOWN', message: `HTTP ${response.status}` } };
    }
    return { data: body.data !== undefined ? body.data : body, error: null };
  } catch (err) {
    return { data: null, error: { code: 'NETWORK_ERROR', message: err.message } };
  }
}
```

**2. Remove per-module `.catch()` overrides**

Every API module switches to:
```javascript
export async function fetchTickets(projectId) {
  const { data, error } = await get(`/api/v1/tickets?project_id=${projectId}`);
  return { data: data || [], error };
}
```

**3. Create `useAsyncState` composable**

```typescript
// frontend/src/composables/useAsyncState.ts
export function useAsyncState() {
  const loading = ref(false);
  const error = ref(null);
  const data = ref(null);

  async function execute(asyncFn) {
    loading.value = true;
    error.value = null;
    try {
      data.value = await asyncFn();
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, data, execute };
}
```

**4. Create `ErrorToast` component**

Global toast managed via provide/inject or Pinia. Subscribes to API errors and displays them with auto-dismiss. Leverages existing emoji patterns for different error types.

### Option B: Full Rewrite
Not recommended — would require touching every file and likely introduce regressions.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/utils/response.js` | CREATE | `sendSuccess`, `sendError`, `sendErrorWithDetails` |
| `backend/src/errors/AppError.js` | CREATE | `AppError`, `NotFoundError`, `ValidationError`, `AuthError`, `ForbiddenError`, `ConflictError`, `RateLimitError` |
| `backend/src/middleware/errorHandler.js` | MODIFY | Handle `AppError` subclasses; use `sendError` |
| `backend/src/middleware/validate.js` | MODIFY | Throw `ValidationError` instead of raw error |
| `backend/src/middleware/auth.js` | MODIFY | Replace console.*; standardize 401/429 responses |
| `backend/src/middleware/permissions.js` | MODIFY | Standardize 403 response |
| `backend/src/api/routes.js` | MODIFY | Auth response shapes; replace console.* |
| `backend/src/api/v1/*.js` | MODIFY | Use `sendSuccess`/`sendError`; replace console.* |
| `backend/src/db.js` | MODIFY | console.error → logger.error |
| `backend/src/api/agents.js` | MODIFY | Replace console.* |
| `backend/src/api/approvals.js` | MODIFY | Replace console.* |
| `backend/src/services/*.js` | MODIFY | Replace console.* where present |
| `frontend/src/api/client.js` | MODIFY | Return `{ data, error }` shape |
| `frontend/src/api/tickets.js` | MODIFY | Remove `.catch(() => [])`; return `{ data, error }` |
| `frontend/src/api/providers.js` | MODIFY | Unify error handling pattern |
| `frontend/src/api/approvals.js` | MODIFY | Add catch handlers |
| `frontend/src/api/memory.js` | MODIFY | Fix error handling |
| `frontend/src/api/github.js` | MODIFY | Fix error handling |
| `frontend/src/api/usage.js` | MODIFY | Fix error handling |
| `frontend/src/api/projects.js` | MODIFY | Fix error handling |
| `frontend/src/api/auth.js` | MODIFY | Fix error handling |
| `frontend/src/composables/useAsyncState.ts` | CREATE | Loading/error/data composable |
| `frontend/src/components/ErrorToast.vue` | CREATE | Global error toast |
| `frontend/src/views/*.vue` | MODIFY | Use `useAsyncState`; remove ad-hoc error states |

---

## Error Code Taxonomy

| Code | HTTP Status | When |
|------|-------------|------|
| `VALIDATION_ERROR` | 400 | Input validation fails |
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `AUTH_EXPIRED_TOKEN` | 401 | JWT expired |
| `AUTH_INVALID_TOKEN` | 401 | JWT malformed |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Duplicate resource |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `NETWORK_ERROR` | 0 (frontend) | Fetch failed (no response) |

---

## Dependencies

- No new npm dependencies
- No database dependencies
- No config changes

---

## Config / Environment Changes

- No new environment variables
- No config changes

---

## Security Considerations

- Verified: `errorHandler.js` already returns generic error for 500 (no stack leaks)
- Verified: logger already masks sensitive data — ensure console.* → logger.* doesn't bypass masking
- Standardized error codes don't leak internal structure

---

## Risks and Edge Cases

- **[Auth flow regression]**: Frontend `Login.vue` and `Register.vue` parse the current non-standard response shapes. Changing the shape will break them unless the frontend is updated in the same PR.
- **[Error code breaking changes]**: If any frontend code checks `error.message` or `error.code` strings, those need updating.

---

## Alternative Designs Considered

### Alternative 1: Global fetch interceptor (axios-like)
- **Pros**: Single place to handle all errors
- **Cons**: AGENTS.md explicitly says "do NOT import axios"; adding an interceptor to native fetch adds complexity
- **Decision**: Keep native fetch; centralize error handling in `apiFetch()` in `client.js`

### Alternative 2: Express async error wrapper
- **Pros**: Catches unhandled promise rejections in route handlers
- **Cons**: All controllers already use try/catch or pass to `next(error)`
- **Decision**: Not needed — existing pattern works; just need to standardize error shapes
