# 03_ARCHITECT_IMPLEMENTATION.md — Backend Code Quality Improvements

**Status**: planned
**Priority**: P3
**Effort**: Medium

---

### Implementation Order

Items are independent and can be parallelized:

1. **Inline require cleanup**: Search for all `const { pool } = require('../db')` inside function bodies. Move to top-level. Check for circular deps.
2. **Ticket.update() dynamic SET**: Replace static COALESCE query with dynamic SET clause builder
3. **stored_path removal**: Remove `storedPath` from `TicketService.getOne()` response mapper
4. **PoolManager max size**: Add `MAX_POOL_SIZE` env var, limit `requestAgent()` when full
5. **Migration version tracking**: Add `schema_migrations` table to `apply.js`. Add check-before-run logic.
6. **process.exit(-1) → 1**: Single line change in `db.js`
7. **res.json patching**: Add comment documenting the conflict. Ensure `requestLogger` patches before `cache` (or merge into single patch).
8. **Route dedup**: Merge `PUT /projects/tickets/:ticketId` and `PUT /tickets/:ticketId` or document intentional difference
9. **req.connection → req.socket**: Replace in all 3+ files
10. **camelCase mapping**: Add `toCamelCase(row)` helper; use consistently in all `fromRow()` methods

### Testing

- [ ] All existing unit tests pass
- [ ] New test: Ticket.update() can null assignee
- [ ] New test: PoolManager rejects when at max capacity
- [ ] New test: migration is idempotent (running twice doesn't error)
- [ ] New test: route ordering is correct (projects/:id/tickets path doesn't conflict with /tickets/:id)
