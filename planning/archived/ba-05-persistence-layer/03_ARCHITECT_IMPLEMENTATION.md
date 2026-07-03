# BA-5: Persistence Layer

**Status**: planned
**Priority**: P0
**Effort**: Medium
**Dependencies**: None

---

### a) Purpose

The persistence layer (models) handles all database interactions: queries, transactions, and data mapping. It should be the only place that knows SQL dialect, table names, and column types. Models transform raw row objects into domain entities.

### b) Actions

1. Audit existing models in `backend/src/models/`:
   - `Ticket.js`
   - `Project.js`
   - `User.js`
2. Fix known issues:
   - Remove `async` from `fromRow()` methods (they have no `await`)
   - Ensure all methods use parameterized queries (prevent SQL injection)
3. Add transaction support:
   ```javascript
   static async transaction(fn) {
     const client = await pool.connect();
     try {
       await client.query('BEGIN');
       const result = await fn(client);
       await client.query('COMMIT');
       return result;
     } catch (error) {
       await client.query('ROLLBACK');
       throw error;
     } finally {
       client.release();
     }
   }
   ```
4. Add soft delete support (optional but recommended):
   ```sql
   ALTER TABLE tickets ADD COLUMN deleted_at TIMESTAMP;
   ```
5. Add created/updated timestamp triggers:
   ```sql
   CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
   BEGIN
     NEW.updated_at = NOW();
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```
6. Create indexes for frequently queried columns:
   ```sql
   CREATE INDEX idx_tickets_project_id ON tickets(project_id);
   CREATE INDEX idx_tickets_status ON tickets(status);
   CREATE INDEX idx_tickets_owner_id ON tickets(owner_id);
   ```

**Current issues to fix:**
- `Ticket.fromRow()` is `async` — remove keyword, return synchronously
- `Ticket.update()` uses `COALESCE($1, title)` pattern — works but hard to distinguish "not provided" from "explicitly null"
- `Ticket.delete()` is hard delete — no soft delete, no cascade protection
- No transaction wrapping for multi-step operations (e.g., create ticket + insert audit log)
- `Project.share()` inserts into `project_memberships` without checking if membership already exists

### c) Dependencies
- `pg` (node-postgres, already in `package.json`)
- `backend/src/db.js` — Pool configuration
- SQL migration files in `backend/src/migrations/`
- Environment: `DATABASE_URL`

### d) Risks/Edge Cases
- **SQL injection**: All queries must use parameterized `$1, $2` syntax — never interpolate strings
- **Connection leaks**: Pool exhaustion under load — set `max` connections, use `pg-limit` or connection pooling (PgBouncer)
- **Schema drift**: Migrations not tracked — consider adding `migrations` table or switching to a migration tool
- **Deadlocks**: Concurrent updates to same rows — use `SELECT FOR UPDATE` or retry logic
- **Data loss**: Hard deletes with no audit trail — implement soft deletes for compliance
- **Null handling**: `COALESCE` can mask bugs — log when fields are skipped during updates

### e) Testing
- [ ] `fromRow()` is synchronous (no `async` keyword)
- [ ] All queries parameterized (no string interpolation)
- [ ] Transaction support: `Model.transaction(fn)` works correctly
- [ ] Soft delete: `deleted_at` column present, queries filter by it
- [ ] Indexes: `idx_tickets_project_id`, `idx_tickets_status`, `idx_tickets_owner_id`
- [ ] Unit tests: model methods tested with mocked `pool.query`

---
