# 01_ARCHITECT_REQUIREMENT.md — Migration Runner Gaps

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Small

---

## Requirement

Register untracked migration files in `migrations/apply.js` so they are executed during database setup. Seven migration SQL files exist on disk (022-028) but are NOT listed in the migration runner, meaning they never execute on fresh database setup. One migration number (019) has no corresponding SQL file at all.

**Problem**: The migration files exist on disk with proper SQL and rollback files, but `migrations/apply.js` does not include them in the `SQL_FILES` array. This means:
1. Fresh database setups skip these migrations entirely
2. The database schema is incomplete — missing `review_diffs`, `environments`, `deployments`, `milestones`, `compute_nodes` tables and `routing_rules` column
3. The migration order in `AGENTS.md` doesn't list these files
4. Any new deployment or test environment will be missing these tables/columns

### Missing from apply.js (exist on disk):
| Migration | File | Description |
|-----------|------|-------------|
| 022 | `022_review_diffs.sql` | Creates `review_diffs` table for code review diffs |
| 023 | `023_environments.sql` | Creates `environments` table for deploy environments |
| 024 | `024_deployments.sql` | Creates `deployments` table with ticket/environment FKs |
| 025 | `025_milestones.sql` | Creates `milestones` table with active-milestone constraint |
| 026 | `026_ticket_milestone_fields.sql` | Adds `milestone_id`, `estimate`, `depends_on` to tickets |
| 027 | `027_compute_nodes.sql` | Creates `compute_nodes` table for agent compute infrastructure |
| 028 | `028_routing_rules.sql` | Adds `routing_rules` JSONB column to `project_providers` |

### Missing entirely:
| Migration | Status |
|-----------|--------|
| 019 | No SQL file exists on disk — may have been deleted or never created |

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Migration Files Check
- [x] `022_review_diffs.sql` exists with `022_review_diffs_rollback.sql`
- [x] `023_environments.sql` exists with `023_environments_rollback.sql`
- [x] `024_deployments.sql` exists with `024_deployments_rollback.sql`
- [x] `025_milestones.sql` exists with `025_milestones_rollback.sql`
- [x] `026_ticket_milestone_fields.sql` exists with `026_ticket_milestone_fields_rollback.sql`
- [x] `027_compute_nodes.sql` exists with `027_compute_nodes_rollback.sql`
- [x] `028_routing_rules.sql` exists with `028_routing_rules_rollback.sql`
- [x] All files use `IF NOT EXISTS` / `DROP IF EXISTS` for idempotency

### Migration Runner Check
- [x] `migrations/apply.js` — SQL_FILES array does NOT include 022-028
- [x] `migrations/apply.js` — current order: 001→002→003→004→005→006→007→008→009→010→013→014→011→012→015→016→017→018→020→021→029→030→031_expand→031_unify
- [x] `AGENTS.md` — migration order matches apply.js (both missing 022-028)

### Migration Dependency Check
- [x] 025 (milestones) must run BEFORE 026 (ticket_milestone_fields) — 026 references milestones table
- [x] 024 (deployments) references environments table — 023 must run BEFORE 024
- [x] 028 (routing_rules) modifies project_providers — 009 (project_providers) must run BEFORE 028
- [x] 027 (compute_nodes) is independent — can go anywhere after 002 (agents_schema)

---

## Scope

### In Scope
- Add migrations 022-028 to `migrations/apply.js` in the correct order
- Update `AGENTS.md` migration order to include 022-028
- Determine the correct position for each migration based on table/column dependencies
- Verify all 022-028 migration files are idempotent (IF NOT EXISTS / DROP IF EXISTS)
- Verify rollback files for 022-028 work correctly

### Out of Scope
- Creating migration 019 (no SQL file exists — may need separate ticket)
- Changing the SQL content of any migration file
- Adding new migrations beyond 028
- Database schema changes beyond registering existing files

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/apply.js` | MODIFY | Add 022-028 to SQL_FILES array in correct order |
| `AGENTS.md` | MODIFY | Update migration order to include 022-028 |
| `database` | NONE | No new SQL — existing files are registered |

---

## Known Unknowns

1. **[Migration 019]**: No SQL file exists for 019. Was it deleted? Was it never created? — Should be investigated separately. May need a new migration file created.
2. **[Existing databases]**: For databases that already have 022-028 tables (via direct SQL execution), re-running them should be safe due to `IF NOT EXISTS`. But if the tables were created with different schemas, there could be conflicts.

---

## Important Design Decisions

1. **Migration order**: Migrations must be ordered by dependency, not by number. The correct order is:
   - 023 (environments) → 024 (deployments, depends on environments)
   - 025 (milestones) → 026 (ticket_milestone_fields, depends on milestones)
   - 028 (routing_rules, depends on project_providers from 009)
   - 022 (review_diffs) — independent, can go after 005 (permissions)
   - 027 (compute_nodes) — independent, can go after 002 (agents)

---

## Acceptance Criteria

1. [ ] All 7 migration files (022-028) are listed in `migrations/apply.js`
2. [ ] Migration order is correct based on table dependencies
3. [ ] Fresh database setup runs all migrations 022-028 successfully
4. [ ] Running migrations twice does not cause errors (idempotency)
5. [ ] Rollback files for 022-028 work correctly
6. [ ] `AGENTS.md` migration order is updated to include 022-028
7. [ ] `schema_migrations` table (if created by bp-61) tracks all applied migrations

---

## Out of Scope

- Creating migration 019 (no SQL file exists)
- Changing the SQL content of any migration file
- Adding new migrations beyond 028
- Database schema changes beyond registering existing files

---

## Security Considerations

- [x] No new endpoints or authentication changes
- [x] No sensitive data handling changes
- [x] All migrations use parameterized DDL (no user input)

---

## Testing Checklist

### Backend Tests
- [ ] Migration 022: `review_diffs` table created with correct schema
- [ ] Migration 023: `environments` table created with correct schema
- [ ] Migration 024: `deployments` table created with FKs to tickets and environments
- [ ] Migration 025: `milestones` table created with unique constraint
- [ ] Migration 026: `milestone_id`, `estimate`, `depends_on` columns added to tickets
- [ ] Migration 027: `compute_nodes` table created with correct schema
- [ ] Migration 028: `routing_rules` JSONB column added to project_providers
- [ ] All rollbacks work: tables/columns removed correctly

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — migrations run against real PG
- [ ] `npm run lint` — no lint errors
