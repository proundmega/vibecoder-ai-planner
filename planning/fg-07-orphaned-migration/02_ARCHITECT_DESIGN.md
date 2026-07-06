# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Two migration files start with `001_` in `backend/src/migrations/`:
- `001_create_tables.sql` — referenced in `apply.js`, actually run
- `001_base_schema.sql` — NOT referenced in `apply.js`, orphaned

This is confusing and could cause issues if someone accidentally runs the wrong file.

---

## Current State

### Existing Backend
- **Migration files**: `backend/src/migrations/001_create_tables.sql` (active) and `001_base_schema.sql` (orphaned)
- **Rollback files**: `001_create_tables_rollback.sql` (active) and `001_base_schema_rollback.sql` (orphaned)
- **apply.js**: References `001_create_tables.sql` at line 7
- **AGENTS.md**: Lists migration order starting with `001_create_tables.sql`

### Gap Analysis
- `001_base_schema.sql` is never run
- `001_base_schema_rollback.sql` is never run
- Two files with the same prefix causes confusion
- Need to compare content to determine if they are duplicates

---

## Design

### Option A: Delete Orphaned Files (Recommended)

**Steps:**
1. Compare `001_base_schema.sql` with `001_create_tables.sql`
2. If they are duplicates (same or very similar content):
   - Delete `001_base_schema.sql`
   - Delete `001_base_schema_rollback.sql`
3. If they differ:
   - Read both files to understand the difference
   - Determine which one is the correct/active schema
   - Delete the orphaned one

**Why this is the right choice**: Cleanup task. No functional changes. Just removes confusion.

### Option B: Rename Orphaned File

Rename `001_base_schema.sql` to `000_base_schema.sql` or `999_base_schema.sql`.

**Pros**: Preserves the file for reference.
**Cons**: Still confusing. Why would an orphaned file exist?
**Decision**: Option A is cleaner.

### Option C: Add Orphaned File to apply.js

Add `001_base_schema.sql` to the migration order.

**Pros**: Would run the file.
**Cons**: If it's a duplicate of `001_create_tables.sql`, it would fail or create duplicate tables.
**Decision**: Option A is correct — don't run files that weren't meant to be run.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/001_base_schema.sql` | DELETE | Orphaned file, not referenced in apply.js |
| `backend/src/migrations/001_base_schema_rollback.sql` | DELETE | Rollback for orphaned file |

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/` | Migration rollback test passes |
| Bash integration | curl + helpers | `backend/integration-test/` | Fresh database migration works |

### Backend Bash Integration Suite — When to Add Tests

Add a test in `backend/integration-test/suites/` to verify:
- Fresh database migration (`npm run db:migrate`) works after file deletion
- Only `001_create_tables.sql` exists (not `001_base_schema.sql`)

---

## Security Considerations

- No new endpoints — this is a file cleanup
- No new data exposure — migration files contain schema, not secrets
- No input changes — this is a file deletion

---

## Data Flow Diagram

```
[Agent reads migrations directory]
  → [Finds 001_base_schema.sql and 001_create_tables.sql]
  → [Compares content]
  → [Deletes orphaned files]
  → [Only 001_create_tables.sql remains]
```

---

## Dependencies

### Backend Dependencies
- None

### Cross-Cutting Dependencies
- `AGENTS.md` — verify migration order documentation is accurate

---

## Config / Environment Changes

- No env var changes
- No database migrations
- No npm dependency changes

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: `001_base_schema.sql` contains important schema that was intentionally not included
  **[Mitigation]**: Compare content with `001_create_tables.sql` before deleting. If the content is significantly different, investigate why.

### Edge Cases
- If the files are identical, deletion is safe
- If `001_base_schema.sql` has additional tables/columns not in `001_create_tables.sql`, those tables might not be created on fresh installs

---

## Alternative Designs Considered

### Alternative 1: Rename instead of delete
- **Pros**: Preserves file for reference
- **Cons**: Still confusing, serves no purpose
- **Decision**: Option A is cleaner

### Alternative 2: Add to apply.js
- **Pros**: Would run the file
- **Cons**: Likely a duplicate, would cause errors
- **Decision**: Option A is correct

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file (if a small model will execute this ticket)

---

*This design document guides implementation. The task is a simple cleanup: compare and delete the orphaned migration file.*
