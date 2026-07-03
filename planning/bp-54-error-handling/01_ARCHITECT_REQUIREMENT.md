# 01_ARCHITECT_REQUIREMENT.md — Error Handling Standardization

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Both
**Priority**: P2
**Effort**: Large

---

## Requirement

Standardize error handling across backend and frontend to eliminate three systemic problems:
1. **~80 `console.*` calls bypass the structured Winston logger** — lost log levels, formatting, and sensitive data masking
2. **Inconsistent API response formats** — auth endpoints return different shapes than the documented `{ success, data }` / `{ success: false, error: { code, message } }` convention
3. **Inconsistent error swallowing** — some API modules catch and return `null`/`[]`, others throw; frontend views have no uniform error display pattern

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] Structured logger exists: `backend/src/utils/logger.js` — Winston with levels, JSON format, sensitive data masking
- [x] Error handler middleware exists: `backend/src/middleware/errorHandler.js` — global catch-all
- [x] Error classes exist: `backend/src/errors/HttpError.js` — `HttpError`, `NotFoundError`, etc.
- [x] Validation middleware exists: `backend/src/middleware/validate.js` — returns 400 with `{ error, details }`
- [x] Auth routes exist: `/api/auth/register`, `/api/auth/login`, `/api/auth/me` — non-standard response shapes
- [x] Permission middleware exists: `backend/src/middleware/permissions.js`

### Frontend API Client Check
- [x] API client exists: `frontend/src/api/client.js` — wraps `fetch()`, extracts `data`, handles 401 with redirect
- [x] API modules exist with inconsistent error handling: `tickets.js` (catch→null), `providers.js` (partial catch), `approvals.js` (no catch)

### Key Insight
This touches both backend (logger consistency, response format) and frontend (error handling patterns, UI error states). Backend work first to establish the contract, then frontend to consume it consistently.

---

## Scope

### In Scope
**Backend:**
- Replace all `console.error`/`console.warn`/`console.log` in `backend/src/` with `logger.error`/`logger.warn`/`logger.info`
- Standardize auth endpoint response shapes to match `{ success: boolean, data: ..., requestId?: string }` format
- Standardize error responses to `{ success: false, error: { code: string, message: string } }` across ALL endpoints
- Add response helper functions (`sendSuccess`, `sendError`) to reduce boilerplate
- Add `AppError` class hierarchy for typed errors with HTTP status codes (400, 401, 403, 404, 409, 429, 500)

**Frontend:**
- Standardize API module error handling — all modules use consistent `.catch()` pattern that returns `{ data: null, error: ... }` shaped objects
- Add uniform error display component (toast/snackbar system) for API errors
- Add loading/error/empty state composable for views to reuse

### Out of Scope
- Changing business logic error messages (only the response shape, not the content)
- Adding new endpoints
- Rewriting the entire error handler — only standardizing existing patterns
- Database changes

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/middleware/errorHandler.js` | MODIFY | Standardize error response shape; use `AppError.code` |
| `backend/src/errors/HttpError.js` | MODIFY | Add `code` property; add `AppError` base class |
| `backend/src/api/routes.js` | MODIFY | Auth response shapes → standardized format |
| `backend/src/api/v1/` | MODIFY | All route handlers → use `sendSuccess`/`sendError` |
| `backend/src/middleware/permissions.js` | MODIFY | Standardize 403 response shape |
| `backend/src/middleware/auth.js` | MODIFY | Standardize 401/429 response shapes |
| `backend/src/` (all files with console.*) | MODIFY | Replace ~80 `console.*` with `logger.*` |
| `frontend/src/api/client.js` | MODIFY | Return `{ data, error }` consistently |
| `frontend/src/api/tickets.js` | MODIFY | Standardize error handling pattern |
| `frontend/src/api/providers.js` | MODIFY | Standardize error handling pattern |
| `frontend/src/api/approvals.js` | MODIFY | Add catch handlers |
| `frontend/src/api/memory.js` | MODIFY | Fix `.catch(() => [])` pattern |
| `frontend/src/api/github.js` | MODIFY | Fix `.catch(() => [])` pattern |
| `frontend/src/api/usage.js` | MODIFY | Fix `.catch(() => [])` pattern |
| `frontend/src/api/projects.js` | MODIFY | Fix `.catch(() => [])` pattern |
| `frontend/src/api/auth.js` | MODIFY | Fix `.catch(() => [])` pattern |
| `frontend/src/components/ErrorToast.vue` | CREATE | Reusable error toast component |
| `frontend/src/composables/useAsyncState.ts` | CREATE | Standard loading/error/data composable |
| `frontend/src/views/*.vue` | MODIFY | Use `useAsyncState` composable; replace ad-hoc loading states |
| `database` | NONE | No DB changes |

---

## Known Unknowns

1. **[Auth response consumers]**: Frontend code may depend on the current non-standard auth response shapes. Need to audit all `Login.vue`, `Register.vue`, and `auth.js` store usage before changing the shape.
2. **[Error code taxonomy]**: What error codes should exist? — Need to define a consistent set (e.g., `VALIDATION_ERROR`, `AUTH_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`).

---

## Important Design Decisions

1. **Error code format**: Use PascalCase strings (`VALIDATION_ERROR`, `NOT_FOUND`, `AUTH_INVALID_CREDENTIALS`) for machine-readable error codes. The `message` field remains human-readable.
2. **Response helper functions**: Add `res.sendSuccess(data, status = 200)` and `res.sendError(code, message, status = 400)` to a middleware that patches `res`. Or export standalone functions. Decision: standalone functions to avoid monkey-patching.
3. **Frontend error shape**: API client returns `{ data: T | null, error: { code: string, message: string } | null }` consistently. Views check `.error` for errors instead of catching.
4. **Error toast**: Single global `ErrorToast` component managed via a Pinia store or provide/inject. No per-view error display logic.

---

## Acceptance Criteria

1. [ ] Zero `console.*` calls remain in `backend/src/` — all use `logger.*`
2. [ ] All API responses follow `{ success: boolean, data: ... }` or `{ success: false, error: { code, message } }`
3. [ ] Auth endpoints (`/auth/register`, `/auth/login`, `/auth/me`) return standardized format
4. [ ] Frontend `client.js` returns `{ data, error }` from every call
5. [ ] All frontend API modules use consistent error handling via `client.js` — no per-module `.catch()` overrides
6. [ ] `ErrorToast` component renders for all API errors automatically
7. [ ] All existing tests pass after refactoring
8. [ ] No regression in auth flow (login, register, token refresh, redirect)

---

## Out of Scope

- Changing business logic error messages
- Adding new API endpoints
- Database changes
- Full UI redesign — only adding error toast component

---

## Performance Considerations

- Adding structured logging replaces `console.*` with Winston transports — no significant overhead
- Response format changes are serialization-only — no performance impact

---

## Security Considerations

- [x] Structured logger already masks sensitive data (tokens, passwords) — verify this continues to work after replacing console.* calls
- [x] Standardized error responses should not leak internal details (stack traces, DB queries) — verify `errorHandler.js` only returns generic 500 for unhandled errors
