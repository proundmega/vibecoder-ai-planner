# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-07 — Remove orphaned migration file 001_base_schema.sql

**Status**: planned | in_progress | completed | blocked
**Priority**: P3
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Remove the orphaned migration file `001_base_schema.sql` which is not referenced in `apply.js` and duplicates `001_create_tables.sql`. Having two files with the same prefix `001_` is confusing and could cause issues if someone accidentally runs the wrong file.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Compare migration files]** — `backend/src/migrations/`
   - Run `diff backend/src/migrations/001_base_schema.sql backend/src/migrations/001_create_tables.sql`
   - If identical or very similar → proceed to deletion
   - If different → read both files to understand the difference, check if `001_base_schema.sql` contains additional tables/columns
   - *Depends on*: nothing

2. **[Delete orphaned files]** — `backend/src/migrations/`
   - Delete `001_base_schema.sql`
   - Delete `001_base_schema_rollback.sql`
   - *Depends on*: Step 1

3. **[Verify cleanup]** — `backend/src/migrations/`
   - Run `ls backend/src/migrations/001*` — should show only `001_create_tables.sql` and `001_create_tables_rollback.sql`
   - Run `grep "001" backend/src/migrations/apply.js` — should show `./001_create_tables.sql`
   - *Depends on*: Step 2

4. **[Run verification]** — `cd backend`
   - `npm test` — migration rollback test should pass
   - *Depends on*: Steps 1, 2, 3

---

### c) Per-File Action Plan

#### `backend/src/migrations/001_base_schema.sql` (DELETE)
- **What to remove**: Entire file
- **Reason**: Orphaned — not referenced in `apply.js`, duplicate of `001_create_tables.sql`

#### `backend/src/migrations/001_base_schema_rollback.sql` (DELETE)
- **What to remove**: Entire file
- **Reason**: Rollback for orphaned file

#### `backend/src/migrations/apply.js` (NONE)
- **No changes needed** — already references `001_create_tables.sql`

---

### d) Dependencies

- None — this is a file cleanup, no runtime dependencies

---

### e) Risks/Edge Cases

- **[Risk]**: `001_base_schema.sql` contains unique schema not in `001_create_tables.sql`
  **[Mitigation]**: Compare files with `diff` before deleting. If different, check if the unique content should be added to `001_create_tables.sql` instead.

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- [ ] `npm test` — migration rollback test should pass (verifies all files in apply.js have rollbacks)

#### Backend Jest Integration Tests
- N/A — no backend API changes

#### Backend Bash Integration Suite
- [ ] Fresh database migration works: `cd backend && npm run db:migrate` — should complete without errors
- [ ] Verify only `001_create_tables.sql` exists: `ls backend/src/migrations/001*`

#### Frontend Unit Tests
- N/A — no frontend changes

#### Frontend Contract Tests
- N/A — no API changes

---

### g) Migration Notes

Not applicable — this is a cleanup task, not a database migration.

---

### h) Files Changed

**Backend:**
```
backend/src/migrations/001_base_schema.sql          → DELETE
backend/src/migrations/001_base_schema_rollback.sql → DELETE
```

---

### i) Code Review Checklist

- [ ] Compared `001_base_schema.sql` with `001_create_tables.sql` using `diff`
- [ ] Orphaned files deleted (`001_base_schema.sql`, `001_base_schema_rollback.sql`)
- [ ] Only one `001_` migration file remains (`001_create_tables.sql`)
- [ ] `apply.js` still references the correct file (`./001_create_tables.sql`)
- [ ] No database changes needed
- [ ] All tests written and passing — existing tests still pass
- [ ] Coverage checked: no significant decrease in changed modules

---

### j) Post-Deploy Verification

1. [ ] `cd backend && npm test` passes
2. [ ] `ls backend/src/migrations/001*` shows only `001_create_tables.sql` and `001_create_tables_rollback.sql`
3. [ ] Fresh database migration works: `cd backend && npm run db:migrate` — completes without errors
4. [ ] Migration rollback test passes (verifies all applied migrations have rollbacks)

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
