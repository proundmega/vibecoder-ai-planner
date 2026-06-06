# RS-1: Database Migration — Users Table

**Status**: completed
**Priority**: P0
**Effort**: Small
**Author**: Lead Architect
**Date created**: 2026-06-05
**Date completed**: 2026-06-06
**PR**: feature/role-system-overhaul
**Branch**: feature/role-system-overhaul

**Dependencies**: None (first ticket in the chain)

---

### a) Purpose

Extend the `users` table to support the new role system, account lifecycle, and creation tracking. This is the foundation for all subsequent tickets.

### b) Actions

1. Create migration file: `backend/src/migrations/003_role_system.sql`
2. Add columns to `users` table:
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
   ALTER TABLE users ADD COLUMN IF NOT EXISTS user_created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
   ```
3. Update role constraint:
   ```sql
   ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_roles;
   ALTER TABLE users ADD CONSTRAINT valid_roles
     CHECK (role IN ('super_admin', 'project_admin', 'member', 'user'));
   ```
4. Migrate existing `admin` users to `project_admin`:
   ```sql
   UPDATE users SET role = 'project_admin' WHERE role = 'admin';
   UPDATE users SET role = 'project_admin' WHERE role = 'ADMIN';
   ```
5. Migrate existing `member` users to `project_admin` (if any):
   ```sql
   UPDATE users SET role = 'project_admin' WHERE role = 'member';
   UPDATE users SET role = 'project_admin' WHERE role = 'MEMBER';
   ```
6. Create `approval_requests` table:
   ```sql
   CREATE TABLE IF NOT EXISTS approval_requests (
     id BIGSERIAL PRIMARY KEY,
     ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
     requested_by BIGINT REFERENCES users(id),
     approved_by BIGINT REFERENCES users(id),
     status VARCHAR(20) DEFAULT 'pending',
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     approved_at TIMESTAMP,
     CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected'))
   );
   CREATE INDEX IF NOT EXISTS idx_approval_requests_ticket_id ON approval_requests(ticket_id);
   CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
   ```
7. Update `User` model in `backend/src/models/user.js`:
   - Add `isActive` and `userCreatedBy` to constructor
   - Update `create()` to accept `role` and `userCreatedBy` parameters
   - Add `findByRole()` method
   - Note: `updateRole()` is REMOVED — roles are immutable once assigned

### c) Dependencies
- None (first ticket in the chain)

### d) Risks/Edge Cases
- **Data loss**: Existing `admin` users must be migrated correctly — test with backup
- **Null user_created_by**: Self-registered users have NULL — handle in UI (show "Self-registered")
- **Circular reference**: User can't reference themselves as creator — validate in service layer
- **Cascading deletes**: When a user is deleted, their `user_created_by` links should become NULL (ON DELETE SET NULL)

### e) Testing
- **Unit tests**: `backend/src/__tests__/unit.test.js` — test `User` model methods: `create()`, `findByRole()`, `isActive`/`userCreatedBy` fields in `fromRow()`
- **Migration test**: Run `003_role_system.sql` against a test database and verify: columns exist, constraint updated, `admin` → `project_admin` migration works, `approval_requests` table created
- **Integration tests**: 60 tests in `backend/src/__tests__/integration/role-system.test.js` all passing

### f) Migration Notes
File: `backend/src/migrations/003_role_system.sql`

```sql
-- Users table additions
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Role constraint update
ALTER TABLE users DROP CONSTRAINT IF EXISTS valid_roles;
ALTER TABLE users ADD CONSTRAINT valid_roles
  CHECK (role IN ('super_admin', 'project_admin', 'member', 'user'));

-- Migration existing roles
UPDATE users SET role = 'project_admin' WHERE role = 'admin';
UPDATE users SET role = 'project_admin' WHERE role = 'ADMIN';
UPDATE users SET role = 'project_admin' WHERE role = 'member';
UPDATE users SET role = 'project_admin' WHERE role = 'MEMBER';

-- Approval requests table
CREATE TABLE IF NOT EXISTS approval_requests (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  requested_by BIGINT REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP,
  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_ticket_id ON approval_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
```

### g) Notes
- Default user role changed from `project_admin` to `user` across all layers (UserService, User model, auth.js, routes.js) to match database schema default and test expectations.
- `afterEach` in `role-system.test.js` clears `approval_requests`, `tickets`, `projects`, `users` tables.
- `jest.integration.config.js` enforces `maxWorkers: 1` to prevent parallel test execution from interfering with cleanup.
