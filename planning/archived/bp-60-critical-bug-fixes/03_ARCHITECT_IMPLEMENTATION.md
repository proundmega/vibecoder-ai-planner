# 03_ARCHITECT_IMPLEMENTATION.md — Critical Backend Bug Fixes

**Status**: planned
**Priority**: P1
**Effort**: Medium

---

### Implementation Order

1. **Bug 1 — UtilityError**: Add class to `errors/HttpError.js` (or use `AppError` from bp-54)
2. **Bug 2 — releaseTicket arity**: Make `adminId` optional with default `null` in `TicketService.js`; add comment that it's for future audit use
3. **Bug 3 — PermissionService init**: Remove `init()` call at module load. Add lazy init with retry to `hasPermission()`.
4. **Bug 4 — server.close callback**: Wrap in promise that resolves after all connections drain
5. **Bug 5 — ticket update validation**: Add Joi schema + validate middleware to route
6. **Bug 6 — unused userId**: Remove from `findByStatus()` signature; update callers
7. **Bug 7 — requireActiveUser errors**: Add error type differentiation
8. **Bug 8 — rateLimiter on /auth/me**: Add `rateLimiter(60000, 30)` to route

### Testing

- [ ] New test for `UtilityError`: verify `new UtilityError()` creates proper error
- [ ] New test for `releaseTicket()`: verify it works without `adminId`
- [ ] New test for `PermissionService`: verify lazy init retries on DB failure
- [ ] New test for graceful shutdown: verify `server.close()` callback is called
- [ ] New test for ticket update: verify 400 on invalid status
- [ ] New test for `requireActiveUser()`: verify 500 for DB error, 403 for deactivation
- [ ] New test for `/auth/me` rate limiting: verify 429 after 31 requests in 60s
- [ ] All existing tests pass
