# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified migration files 022-028 exist on disk with their rollback counterparts
- [ ] I have verified migration 019 does NOT exist on disk
- [ ] I have checked `migrations/apply.js` — confirmed 022-028 are NOT in the SQL_FILES array
- [ ] I have checked `AGENTS.md` migration order — confirmed 022-028 are NOT listed
- [ ] I have checked if migrations 022-028 are idempotent (IF NOT EXISTS, DROP IF EXISTS)
- [ ] I have checked if `schema_migrations` table exists (from bp-61 if already merged)

### Testing Strategy

- [ ] Run migrations against a test database to verify 022-028 execute without errors
- [ ] Run migrations twice to verify idempotency
- [ ] Run rollback for 022-028 to verify rollback files work
- [ ] Verify migration order is correct (dependencies between migrations)

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All migrations 022-028 run successfully against a fresh database
- [ ] All rollback files work correctly
- [ ] Migration order in `apply.js` matches the logical dependency order
- [ ] `AGENTS.md` migration order is updated
- [ ] `schema_migrations` table tracks all applied migrations
