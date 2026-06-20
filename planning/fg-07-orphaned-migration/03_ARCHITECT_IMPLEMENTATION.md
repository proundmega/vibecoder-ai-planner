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

Remove the orphaned migration file `001_base_schema.sql` which is not referenced in `apply.js` and duplicates `001_create_tables.sql`. Having two files with the same prefix is confusing.

---

### b) Actions

#### Phase 1: Investigation

1. Compare the two `001_` migration files:
   ```bash
   diff backend/src/migrations/001_base_schema.sql backend/src/migrations/001_create_tables.sql
   ```

2. If they are identical or very similar → proceed to deletion.
3. If they differ significantly → read both files to understand the difference. Check if `001_base_schema.sql` contains additional tables/columns not in `001_create_tables.sql`.

#### Phase 2: Cleanup

4. Delete the orphaned files:
   ```bash
   rm backend/src/migrations/001_base_schema.sql
   rm backend/src/migrations/001_base_schema_rollback.sql
   ```

5. Verify only one `001_` file remains:
   ```bash
   ls backend/src/migrations/001*
   # Should show only: 001_create_tables.sql  001_create_tables_rollback.sql
   ```

6. Verify `apply.js` still references the correct file:
   ```bash
   grep "001" backend/src/migrations/apply.js
   # Should show: ./001_create_tables.sql
   ```

#### Phase 3: Testing

7. Run backend tests: `cd backend && npm test`
8. Verify migration rollback test passes (it checks all files in apply.js have rollbacks)

---

### c) Dependencies

- None

---

### d) Risks/Edge Cases

- **[Risk]**: `001_base_schema.sql` contains unique schema not in `001_create_tables.sql`
  **[Mitigation]**: Compare files before deleting. If different, check if the unique content should be added to `001_create_tables.sql` instead.

---

### e) Testing

#### Backend Unit Tests
- [ ] `npm test` — migration rollback test should pass

#### CI Requirements
- [ ] `npm test` — backend tests pass

---

### f) Migration Notes

Not applicable — this is a cleanup task, not a database migration.

---

### g) Files Changed

**Backend:**
```
backend/src/migrations/001_base_schema.sql          → deleted
backend/src/migrations/001_base_schema_rollback.sql → deleted
```

---

### h) Code Review Checklist

- [ ] Compared `001_base_schema.sql` with `001_create_tables.sql`
- [ ] Orphaned files deleted
- [ ] Only one `001_` migration file remains
- [ ] `apply.js` still references the correct file
- [ ] All tests pass
- [ ] No database changes needed

---

### i) Post-Deploy Verification

1. [ ] `cd backend && npm test` passes
2. [ ] `ls backend/src/migrations/001*` shows only `001_create_tables.sql` and `001_create_tables_rollback.sql`
3. [ ] Fresh database migration (`npm run db:migrate`) works correctly
