# 02_ARCHITECT_DESIGN.md — Backend Code Quality Improvements

**Status**: Working draft

---

## Design Decisions

### 1. Inline `require('../db')` Standardization
- **Problem**: Inline requires were likely introduced to avoid circular dependencies between services and db.js
- **Solution**: Move `const { pool } = require('../db')` to the top of each file. If circular dependency exists, extract a `db.js` wrapper that both can import without cycles. Verify tree by reading require graph.

### 2. `Ticket.update()` COALESCE Replacement
- **Current**: `COALESCE($1, title)` — null values fall back to existing column value
- **Solution**: Build dynamic SET clause based on which fields are explicitly provided. If a field is `undefined`, skip it. If it's `null`, set to NULL. If it has a value, set to that value.
- **Risk**: Changes the SQL generation logic — must test all update paths

### 3. `PoolManager` Max Size
- **Current**: `this.pool = new Map()` with no upper bound
- **Solution**: Add `MAX_POOL_SIZE` env var (default: 10). `requestAgent()` returns error when pool is full. Cleanup interval evicts idle agents first when at capacity.

### 4. Migration Version Tracking
- **Current**: `apply.js` runs all SQL files unconditionally, catches "already exists" errors silently
- **Solution**: Add `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`. Before running each SQL file, check if version already applied. Skip if applied.

---

## File-Level Impact Matrix

| File | Action |
|------|--------|
| Multiple `services/*.js` | MODIFY — inline require → top-level |
| `models/ticket.js` | MODIFY — dynamic SET clause |
| `services/TicketService.js` | MODIFY — strip stored_path from response |
| `services/PoolManager.js` | MODIFY — add max pool size |
| `migrations/apply.js` | MODIFY — add version tracking |
| `db.js` | MODIFY — process.exit(1) |
| `middleware/requestLogger.js` | MODIFY — fix patch order |
| `middleware/cache.js` | MODIFY — fix patch order |
| `api/routes.js` | MODIFY — req.socket |
| `api/projects.js` | MODIFY — review routes |
| `api/tickets.js` | MODIFY — review routes |

---

## Testing

- [ ] `Ticket.update()` test: set field to null → field is NULL in DB
- [ ] `TicketService.getOne()` test: response does not contain `storedPath`
- [ ] `PoolManager` test: pool refuses new requests when at max capacity
- [ ] Migration test: running `apply.js` twice does not re-apply same migrations
- [ ] Route test: no 404/conflict between overlapping project/ticket routes
