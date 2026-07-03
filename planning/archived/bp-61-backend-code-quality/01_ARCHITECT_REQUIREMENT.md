# 01_ARCHITECT_REQUIREMENT.md — Backend Code Quality Improvements

**Status**: planned
**Priority**: P3
**Effort**: Medium
**Scope**: Backend

---

## Requirement

Fix maintainability issues that increase bug risk and make the codebase harder to work with.

### Issues Addressed

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | 34+ inline `require('../db')` calls instead of top-level imports | MEDIUM | Multiple service files |
| 2 | `Ticket.update()` uses `COALESCE` — cannot clear fields to `null` | MEDIUM | `models/ticket.js:94-105` |
| 3 | `stored_path` leaked in API responses | MEDIUM | `services/TicketService.js:43` |
| 4 | `PoolManager.pool` Map has no size limit | MEDIUM | `services/PoolManager.js:19` |
| 5 | No migration version tracking — migrations may run multiple times | LOW | `migrations/apply.js` |
| 6 | `process.exit(-1)` — negative exit codes truncated to 255 | LOW | `db.js:14` |
| 7 | `res.json` monkey-patching conflict between `requestLogger` and `cache` middleware | MEDIUM | `middleware/requestLogger.js`, `middleware/cache.js` |
| 8 | Route ordering may cause conflicts between `projects.js` and `tickets.js` | MEDIUM | `api/projects.js`, `api/tickets.js` |
| 9 | Deprecated `req.connection` used in 3+ files | LOW | `routes.js`, `auth.js`, `requestLogger.js` |
| 10 | `Ticket.fromRow()` returns camelCase but raw `pool.query` returns snake_case — easy to mix up | LOW | `models/ticket.js`, `services/TicketService.js` |

---

## Scope

### In Scope
1. Standardize all `require('../db')` patterns to top-level imports (or remove circular dependency hack)
2. Rewrite `Ticket.update()` to support setting fields to `null`
3. Strip `stored_path` from API responses
4. Add max pool size config to `PoolManager`
5. Add `schema_migrations` tracking table to migration runner
6. Replace `process.exit(-1)` with `process.exit(1)`
7. Fix `res.json` monkey-patching order or replace with proper middleware
8. Review and deduplicate overlapping routes between projects/tickets
9. Replace `req.connection` with `req.socket`
10. Add `toCamelCase()` helper for consistent DB row mapping

### Out of Scope
- Rewriting the entire ORM layer
- Backend TypeScript migration
- Adding new features

---

## Acceptance Criteria

1. [ ] `const { pool } = require('../db')` is a single top-level import per file — no inline requires
2. [ ] `Ticket.update()` can set fields back to `null` (e.g., clearing assignee)
3. [ ] API responses do not include `storedPath` from attachments
4. [ ] `PoolManager` has `maxPoolSize` config (env var), rejects requests when full
5. [ ] Migration runner creates and checks `schema_migrations` table before running SQL
6. [ ] `process.exit(1)` used instead of `process.exit(-1)`
7. [ ] `res.json` patch ordering is documented/fixed — `requestLogger` wraps `cache` or vice versa
8. [ ] No route conflicts between `PUT /projects/tickets/:ticketId` and `PUT /tickets/:ticketId`
9. [ ] `req.socket.remoteAddress` used everywhere instead of `req.connection.remoteAddress`
10. [ ] Consistent camelCase mapping from DB rows throughout service layer
