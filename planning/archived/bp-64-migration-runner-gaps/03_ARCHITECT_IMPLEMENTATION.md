# 03_ARCHITECT_IMPLEMENTATION.md — Migration Runner Gaps

**Status**: planned
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Register seven untracked migration files (022-028) in `migrations/apply.js` so they execute during database setup, restoring the complete database schema.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

1. **Verify migration files are idempotent** — `backend/src/migrations/022-028_*.sql`
   - Confirm all use `IF NOT EXISTS` for CREATE TABLE / ADD COLUMN
   - Confirm all use `DROP IF EXISTS` for rollback
   - *Depends on*: nothing

2. **Insert migrations into apply.js** — `backend/src/migrations/apply.js`
   - Add 022-028 at correct positions in SQL_FILES array
   - *Depends on*: Step 1

3. **Update AGENTS.md** — `AGENTS.md`
   - Update migration order to include 022-028
   - *Depends on*: Step 2

4. **Test against fresh database** — local PostgreSQL
   - Run `apply.js` against a fresh database
   - Verify all 022-028 tables/columns are created
   - Run `apply.js` again — verify idempotency (no errors)
   - *Depends on*: Step 2

---

### c) Per-File Action Plan

#### `backend/src/migrations/apply.js` (MODIFY)

Insert migrations 022-028 at these positions in the SQL_FILES array:

```javascript
const SQL_FILES = [
  path.join(__dirname, './001_create_tables.sql'),
  path.join(__dirname, './002_agents_schema.sql'),
  path.join(__dirname, './003_role_system.sql'),
  path.join(__dirname, './004_persistence_layer.sql'),
  path.join(__dirname, './005_permission_system.sql'),
  path.join(__dirname, './022_review_diffs.sql'),       // NEW: after 005
  path.join(__dirname, './006_ticket_comments.sql'),
  path.join(__dirname, './007_project_repos.sql'),
  path.join(__dirname, './008_ticket_repo_fields.sql'),
  path.join(__dirname, './009_project_providers.sql'),
  path.join(__dirname, './028_routing_rules.sql'),      // NEW: after 009
  path.join(__dirname, './010_project_credentials.sql'),
  path.join(__dirname, './013_usage_logs.sql'),
  path.join(__dirname, './014_project_billing.sql'),
  path.join(__dirname, './011_ticket_ownership.sql'),
  path.join(__dirname, './012_agent_users.sql'),
  path.join(__dirname, './015_shared_agent_memory.sql'),
  path.join(__dirname, './016_ticket_planning.sql'),
  path.join(__dirname, './017_agent_memory_fallback.sql'),
  path.join(__dirname, './018_ticket_phases.sql'),
  path.join(__dirname, './020_provider_configs.sql'),
  path.join(__dirname, './021_agent_heartbeats.sql'),
  path.join(__dirname, './023_environments.sql'),       // NEW: before 024
  path.join(__dirname, './024_deployments.sql'),        // NEW: after 023
  path.join(__dirname, './025_milestones.sql'),         // NEW: before 026
  path.join(__dirname, './026_ticket_milestone_fields.sql'), // NEW: after 025
  path.join(__dirname, './027_compute_nodes.sql'),      // NEW: after 021 (agents FK)
  path.join(__dirname, './029_provider_config_api_key.sql'),
  path.join(__dirname, './030_uuid_to_bigint_fk.sql'),
  path.join(__dirname, './031_expand_credential_types.sql'),
  path.join(__dirname, './031_unify_providers.sql'),
];
```

#### `AGENTS.md` (MODIFY)

Update the migration order in the Architecture section:

```
001→002→003→004→005→006→007→008→009→010→013→014→011→012→015→016→017→018→020→021→022→023→024→025→026→027→028→029→030→031_expand_credential_types→031_unify_providers
```

---

### d) Dependencies

- No new npm dependencies
- PostgreSQL database for testing

---

### e) Risks/Edge Cases

- **[Existing databases with direct SQL]**: If a production database already has 022-028 tables (applied manually), re-running should be safe due to `IF NOT EXISTS`. But verify all migration files use idempotent DDL.
- **[Migration 019 gap]**: The numbering gap at 019 remains. This is cosmetic and doesn't affect functionality.

---

### f) Testing

#### Backend Unit Tests
- [ ] Test: `apply.js` runs all SQL files without errors against fresh PG
- [ ] Test: Running `apply.js` twice produces no errors (idempotency)
- [ ] Test: All 022-028 tables exist after migration run
- [ ] Test: Rollback files for 022-028 remove tables/columns correctly

#### Backend Integration Tests
- [ ] `npm run test:integration` — migrations run against real PG
- [ ] Verify `review_diffs` table exists with correct columns
- [ ] Verify `environments` table exists with correct columns
- [ ] Verify `deployments` table exists with correct FKs
- [ ] Verify `milestones` table exists with correct constraints
- [ ] Verify `tickets` has `milestone_id`, `estimate`, `depends_on` columns
- [ ] Verify `compute_nodes` table exists with correct columns
- [ ] Verify `project_providers` has `routing_rules` JSONB column

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass
- [ ] `npm run lint` — no lint errors

---

### g) Migration Notes

No database migrations needed — this registers existing migration files. The `schema_migrations` table (if created by bp-61) will track these migrations automatically.

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/apply.js    → MODIFY (add 022-028 to SQL_FILES)
AGENTS.md                          → MODIFY (update migration order)
```

---

### i) Code Review Checklist

- [ ] All 7 migration files (022-028) are in SQL_FILES array
- [ ] Migration order respects dependencies (023→024, 025→026, 009→028)
- [ ] All migration files use `IF NOT EXISTS` (idempotent)
- [ ] All rollback files use `DROP IF EXISTS`
- [ ] `AGENTS.md` migration order updated
- [ ] Fresh database setup works with all migrations
- [ ] Running migrations twice produces no errors

---

### j) Post-Deploy Verification

1. [ ] `npm run db:migrate` — all migrations run without errors
2. [ ] `psql -c "SELECT * FROM schema_migrations ORDER BY version;"` — all 022-028 tracked
3. [ ] `psql -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('review_diffs','environments','deployments','milestones','compute_nodes');"` — all tables exist
4. [ ] `psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='tickets' AND column_name IN ('milestone_id','estimate','depends_on');"` — columns exist
5. [ ] `psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='project_providers' AND column_name='routing_rules';"` — column exists
6. [ ] `npm test` — backend tests pass
7. [ ] `npm run lint` — no lint errors
