# 03_ARCHITECT_IMPLEMENTATION.md — Migration Rollback

**Status**: planned
**Priority**: P3 (Low)
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-09-migration-rollback

**Dependencies**: None

---

### a) Purpose

Add migration rollback support for safe deployments and quick recovery from failed migrations.

**Value delivered**: Can undo migrations if they cause issues. Enables safer deployment process.

---

### b) Actions

1. **Create migration tracking** — `backend/src/migrations/apply.js`
   - Create `_migrations` table
   - Track applied migrations with version, name, applied_at

2. **Create rollback script** — `backend/src/migrations/rollback.js`
   - Rollback specific version or latest
   - Use transactions for atomicity

3. **Create rollback SQL files** — `src/migrations/*_rollback.sql`
   - Reverse each migration (DROP instead of CREATE)

4. **Add npm scripts** — `backend/package.json`
   - `db:rollback:latest` — rollback last migration
   - `db:rollback` — rollback specific version

5. **Create tests**
   - `backend/src/__tests__/migrationRollback.test.js`

---

### c) Dependencies

- **None** — self-contained change

---

### d) Risks/Edge Cases

- **[Data loss]**: Rollback may drop data. Document what data is lost.
- **[Partial rollback]**: Use transactions to ensure atomicity.

---

### e) Testing

#### Unit Tests
- [ ] Migration tracking table created
- [ ] Rollback undoes migration correctly
- [ ] Rollback of non-applied migration returns error

#### Integration Tests
- [ ] Forward then rollback restores original state
- [ ] Rollback of latest migration works
- [ ] Rollback of specific migration works

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: Minimal — adds tracking table and rollback scripts, does not modify existing data
- **Downtime**: None — code-only change, no restart required
- **Verification after rollback**: Run `npm test` to confirm tests pass

---

### g) Files Changed

- `backend/src/migrations/apply.js` — CHANGED
- `backend/src/migrations/rollback.js` — NEW
- `backend/src/migrations/001_create_tables_rollback.sql` — NEW
- `backend/src/migrations/002_agents_schema_rollback.sql` — NEW
- `backend/src/migrations/003_role_system_rollback.sql` — NEW
- `backend/src/migrations/004_persistence_layer_rollback.sql` — NEW
- `backend/src/migrations/005_permission_system_rollback.sql` — NEW
- `backend/src/migrations/006_ticket_comments_rollback.sql` — NEW
- `backend/src/migrations/007_project_repos_rollback.sql` — NEW
- `backend/src/migrations/008_ticket_repo_fields_rollback.sql` — NEW
- `backend/src/migrations/009_project_providers_rollback.sql` — NEW
- `backend/src/migrations/010_project_credentials_rollback.sql` — NEW
- `backend/src/migrations/013_usage_logs_rollback.sql` — NEW
- `backend/src/migrations/014_project_billing_rollback.sql` — NEW
- `backend/src/migrations/011_ticket_ownership_rollback.sql` — NEW
- `backend/src/migrations/012_agent_users_rollback.sql` — NEW
- `backend/src/migrations/015_shared_agent_memory_rollback.sql` — NEW
- `backend/package.json` — CHANGED
- `backend/src/__tests__/migrationRollback.test.js` — NEW

---

### h) Code Review Checklist

- [ ] `_migrations` table uses transactional DDL (PostgreSQL supports this)
- [ ] Each rollback SQL file is the exact inverse of the forward migration
- [ ] Rollback script uses transactions for atomicity
- [ ] Rollback of non-applied migration returns clear error
- [ ] npm scripts are correctly named and executable
- [ ] Data loss from rollback is documented in each rollback SQL file

---

### i) Post-Deploy Verification

- [ ] Run `npm run db:migrate` to confirm forward migrations still work
- [ ] Run `npm run db:rollback:latest` to verify rollback works
- [ ] Run `npm run db:migrate` again to verify re-migration works
- [ ] Check `_migrations` table has correct entries
- [ ] Verify no data loss in existing tables after forward/rollback cycle

---

### j) Migration Notes

None — pure code change.

---

### k) Notes

- Migration tracking: `_migrations` table with version, name, applied_at
- Rollback: transactional, atomic
- CLI: `npm run db:rollback:latest`, `npm run db:rollback -- 003`

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, tracking table, rollback script*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
