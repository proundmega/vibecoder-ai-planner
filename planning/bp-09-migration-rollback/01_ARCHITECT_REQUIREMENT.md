# 01_ARCHITECT_REQUIREMENT.md — Migration Rollback

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Database migrations must support rollback (not just forward) to enable safe deployments and quick recovery from failed migrations.

---

## Scope

- Add rollback scripts for each migration
- Track migration state in database
- Support `npm run db:rollback` command

---

## Assumptions

- Migrations are SQL files in `src/migrations/` (17 files, ad-hoc, no migration tracking system)
- `src/migrations/apply.js` runs all migrations in order using `fs.readdirSync` + `fs.readFileSync`
- No migration tracking table exists currently (no `migrations` or `schema_migrations` table)
- The database is PostgreSQL 15 (confirmed by `docker-compose.yml` and `AGENTS.md`)
- Rollback scripts should be SQL files (`.sql`) or JavaScript functions (`.js`) that execute SQL
- Data loss during rollback is acceptable for most migrations (DROP TABLE, DROP COLUMN) but NOT for others (data transformations)

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **How do we track migration state?**
   - Add `migrations` table with `version`, `name`, `applied_at` columns
   - Or use a separate migration tracking system?

2. **How do rollbacks work?**
   - Each migration has a corresponding `rollback` function
   - Or use reversed SQL (DROP instead of CREATE)?

3. **Should rollbacks be automated or manual?**
   - Manual: `npm run db:rollback -- 001` (explicit, safe)
   - Automated: `npm run db:rollback:latest` (rollback last migration)

---

## Acceptance Criteria

- [ ] A `migrations` table is created in the database with columns: `version` (int, primary key), `name` (varchar), `applied_at` (timestamp)
- [ ] `apply.js` checks the `migrations` table before applying a migration (skips already-applied migrations)
- [ ] Each migration file has a corresponding rollback script (either `00X_migration_name.rollback.sql` or a rollback function in `apply.js`)
- [ ] `npm run db:rollback -- <version>` rolls back a specific migration by version number
- [ ] `npm run db:rollback:latest` rolls back the most recently applied migration
- [ ] Rollback of a non-applied migration returns a clear error message
- [ ] Rollback removes the migration record from the `migrations` table
- [ ] Rollback is idempotent (running rollback twice on the same migration does not error)
- [ ] Unit tests verify migration tracking and rollback logic
- [ ] Linting passes with no errors

---

## Out of Scope

- Automated rollback on deployment failure (CI/CD integration — separate concern)
- Migration dependencies (migration B depends on migration A — not currently modeled)
- Migration grouping or batch rollbacks (rollback multiple migrations at once)
- Migration dry-run (preview what would change without applying)
- Migration versioning for multiple environments (dev/staging/prod — handled by separate DATABASE_URL)
- Rollback data backup (no automatic backup before rollback)
- Migration conflict detection (two people applying migrations simultaneously)

---

## Testing Checklist

- [ ] Forward migration applies correctly
- [ ] Rollback undoes migration correctly
- [ ] Migration state tracked in database
- [ ] Rollback of non-applied migration returns error

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Rollback that drops data irreversibly (no backup)
- ❌ Rollback that doesn't restore original schema state
- ❌ No migration tracking (can't tell what's been applied)

---

*Ready for design phase.*
