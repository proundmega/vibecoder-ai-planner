# 02_ARCHITECT_DESIGN.md — Critical Backend Bug Fixes

**Status**: Working draft

---

## Bug Details

### Bug 1: `UtilityError` not defined
- **File**: `services/ProvisioningService.js:5` imports `{ UtilityError } from '../errors/HttpError'`
- **File**: `errors/HttpError.js` — only exports `HttpError`, `NotFoundError`, etc.; no `UtilityError`
- **Fix**: Add `UtilityError` class to `errors/HttpError.js` or replace with `AppError` (from bp-54 if already merged)

### Bug 2: `releaseTicket()` arity mismatch
- **Signature**: `async releaseTicket(ticketId, adminId)`
- **Caller**: `HeartbeatService.cleanupStaleAgents()` → `TicketService.releaseTicket(agent.current_ticket_id)` — missing `adminId`
- **Fix**: Make `adminId` truly optional with default `null`, or remove it if unused

### Bug 3: `PermissionService.init()` crash on DB failure
- **File**: `services/PermissionService.js:69` — `init().catch(console.error)`
- **Problem**: If DB is down during require, `init()` throws, `.catch` swallows it, cache is empty, all `hasPermission()` calls return `false`
- **Fix**: Remove `init()` from module load. Lazy-populate cache on first `hasPermission()` call. Add retry with backoff.

### Bug 4: Server shutdown doesn't drain
- **File**: `utils/shutdown.js:30` — `server.close()` without callback
- **Fix**: Pass callback that waits for active connections to close before calling `pool.end()`

### Bug 5: Missing ticket update validation
- **Route**: `PUT /projects/tickets/:ticketId` in `api/projects.js:246`
- **Fix**: Add `validate(ticketUpdateSchema)` middleware and create Joi schema

### Bug 6: Unused `userId` parameter
- **File**: `services/TicketService.js:24-26`
- **Fix**: Remove `userId` from signature or pass it to `Ticket.findByStatus()`

### Bug 7: Misleading error in `requireActiveUser()`
- **File**: `middleware/auth.js:89-103` — catch always returns "Account deactivated"
- **Fix**: Check error type — DB errors → 500, deactivation → 403

### Bug 8: Missing rate limiter on `/auth/me`
- **Route**: `api/routes.js:274` — no `rateLimiter` applied
- **Fix**: Add `rateLimiter(60000, 30)` — 30 requests per minute

---

## File-Level Impact Matrix

| File | Action |
|------|--------|
| `backend/src/errors/HttpError.js` | MODIFY — add `UtilityError` |
| `backend/src/services/TicketService.js` | MODIFY — fix `releaseTicket()`, `findByStatus()` |
| `backend/src/services/HeartbeatService.js` | MODIFY — pass context to `releaseTicket()` |
| `backend/src/services/PermissionService.js` | MODIFY — lazy cache init with retry |
| `backend/src/utils/shutdown.js` | MODIFY — callback on `server.close()` |
| `backend/src/api/projects.js` | MODIFY — add validate middleware |
| `backend/src/middleware/auth.js` | MODIFY — fix `requireActiveUser()` error handling |
| `backend/src/api/routes.js` | MODIFY — add rateLimiter to `/auth/me` |

---

## Dependencies

- Bug 1 depends on whether bp-54 (AppError classes) has been merged — if so, use `AppError` instead of creating `UtilityError` in HttpError.js
- All other fixes are independent
