# 01_ARCHITECT_REQUIREMENT.md — Critical Backend Bug Fixes

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Backend

---

## Requirement

Fix critical runtime bugs that could crash the application or cause silent data loss.

### Issues Addressed

| # | Issue | Severity | File |
|---|-------|----------|------|
| 1 | `UtilityError` imported but never exported from `HttpError.js` — throws `TypeError: UtilityError is not a constructor` at runtime | CRITICAL | `ProvisioningService.js:5`, `errors/HttpError.js` |
| 2 | `TicketService.releaseTicket()` called with 1 arg but expects 2 (`ticketId, adminId`) | HIGH | `HeartbeatService.js:69`, `TicketService.js:288` |
| 3 | `PermissionService.init()` runs at module load with `.catch(console.error)` — DB failure silently locks all users out | HIGH | `services/PermissionService.js:69` |
| 4 | `server.close()` in graceful shutdown has no callback — pool closes while requests in flight | HIGH | `utils/shutdown.js:30` |
| 5 | No input validation on `PUT /projects/tickets/:ticketId` — status not validated against enum | HIGH | `api/projects.js:246` |
| 6 | `TicketService.findByStatus()` accepts `userId` parameter but never passes it to `Ticket.findByStatus()` | MEDIUM | `services/TicketService.js:24-26` |
| 7 | `requireActiveUser()` always returns "Account deactivated" for any error (not just deactivation) | MEDIUM | `middleware/auth.js:100-102` |
| 8 | No `rateLimiter` on `/auth/me` — attacker can brute-force token validation | MEDIUM | `api/routes.js:274` |

---

## Scope

### In Scope
1. Add `UtilityError` class to `errors/HttpError.js` or use existing error class
2. Make `adminId` optional in `releaseTicket()` or pass proper agent context from heartbeat
3. Defer `PermissionService.init()` to first request with retry logic
4. Add callback to `server.close()` before closing pool
5. Add `validate()` middleware + Joi schema for ticket update route
6. Remove unused `userId` parameter from `findByStatus()` or wire it into query
7. Differentiate error types in `requireActiveUser()` — 403 for deactivation, 500 for DB errors
8. Add `rateLimiter()` to `/auth/me` endpoint

### Out of Scope
- Backend code quality improvements (covered in bp-61)
- Security issues (covered in bp-58)

---

## Acceptance Criteria

1. [ ] `ProvisioningService.getNode()` throws proper error instead of `TypeError`
2. [ ] `HeartbeatService.cleanupStaleAgents()` does not crash
3. [ ] `PermissionService` handles DB failure gracefully with retry
4. [ ] Graceful shutdown drains HTTP connections before closing pool
5. [ ] `PUT /projects/tickets/:ticketId` validates status against enum
6. [ ] `findByStatus()` either uses `userId` or removes parameter from signature
7. [ ] `requireActiveUser()` returns 500 for DB errors, 403 only for deactivation
8. [ ] `/auth/me` has rate limiter applied
9. [ ] All existing tests pass
10. [ ] New regression tests for each fixed bug
