# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: 2026-06-19
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P3
**Effort**: Small

---

## Requirement

Remove the orphaned migration file `001_base_schema.sql` (and its rollback `001_base_schema_rollback.sql`). This file is not referenced in `apply.js` and is a duplicate of `001_create_tables.sql`. Having two files with the same prefix `001_` is confusing and could cause issues if someone accidentally runs the wrong one.

**Current behavior**: Two migration files start with `001_` — `001_create_tables.sql` (in apply.js) and `001_base_schema.sql` (orphaned).
**Expected behavior**: Only one `001_` migration file exists.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] Migration file exists: `backend/src/migrations/001_base_schema.sql` — YES
- [x] Rollback exists: `backend/src/migrations/001_base_schema_rollback.sql` — YES
- [x] In apply.js: `backend/src/migrations/apply.js:7` — references `001_create_tables.sql` (NOT `001_base_schema.sql`)
- [x] Content comparison needed: Are `001_base_schema.sql` and `001_create_tables.sql` duplicates?

### Key Insight

This is a **CLEANUP task**. The file `001_base_schema.sql` exists but is never run by `apply.js`. It's either:
1. A duplicate of `001_create_tables.sql` (replace file)
2. An older version that was superseded (delete file)
3. A different schema that was intentionally not included (investigate content)

---

## Scope

### In Scope
- [ ] Compare `001_base_schema.sql` with `001_create_tables.sql` to determine if they are duplicates
- [ ] If duplicates: delete `001_base_schema.sql` and `001_base_schema_rollback.sql`
- [ ] If different: determine which one should be kept and which should be removed
- [ ] Update `AGENTS.md` migration order if needed (it references the actual applied migrations)

### Out of Scope
- Changes to the actual migration content
- Database changes (these files are never run)
- Creating new migrations

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/001_base_schema.sql` | DELETE | Orphaned file, not referenced in apply.js |
| `backend/src/migrations/001_base_schema_rollback.sql` | DELETE | Rollback for orphaned file |
| `database` | NONE | No schema changes (orphaned file is never run) |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[File content comparison]**: `001_base_schema.sql` may or may not be a duplicate of `001_create_tables.sql`. **Resolution**: Run `diff` before deleting. If different, investigate why.
2. **[AGENTS.md accuracy]**: AGENTS.md may reference `001_base_schema.sql` in the migration order. **Resolution**: Check and update if needed.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

The decision is straightforward:
- If the files are duplicates → delete the orphaned one
- If they differ → investigate why, then delete the one that's not used

---

## Acceptance Criteria

1. [ ] [Backend] `001_base_schema.sql` is removed (or confirmed as needed)
2. [ ] [Backend] `001_base_schema_rollback.sql` is removed (or confirmed as needed)
3. [ ] [Backend] Only one `001_` migration file exists in `backend/src/migrations/`
4. [ ] [Documentation] `AGENTS.md` migration order is accurate
5. [ ] [Tests] Migration rollback test still passes (it checks all files in apply.js have rollbacks)

---

## Out of Scope

- Changes to migration content
- Database schema changes
- Creating new migrations
- Modifying `apply.js` (it already references the correct file)

---

## Performance Considerations

- Expected load: N/A — this is a file cleanup, no runtime impact
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A

---

## Security Considerations

- Authentication required: N/A — this is a file cleanup
- Authorization check: N/A
- Input validation: N/A
- Sensitive data handling: No change — migration files contain schema, not secrets

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `npm test` — migration rollback test should still pass
- [ ] Manual: Verify `apply.js` still references the correct `001_create_tables.sql`

### Frontend Contract Tests
- N/A — no API changes

### CI Requirements
- [ ] `npm test` — backend tests pass

---

## Anti-Patterns to Avoid

- ❌ **Deleting without comparing** — verify the files are duplicates before deleting
- ❌ **Changing apply.js** — the apply.js already references the correct file
- ❌ **Renaming instead of deleting** — if it's not used, delete it
