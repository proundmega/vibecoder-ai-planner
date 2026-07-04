# 02_ARCHITECT_DESIGN.md — Migration Runner Gaps

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Seven migration SQL files (022-028) exist on disk with proper SQL and rollback files, but are NOT listed in `migrations/apply.js`. This means fresh database setups skip these migrations entirely, resulting in an incomplete database schema. The missing tables/columns include `review_diffs`, `environments`, `deployments`, `milestones`, `compute_nodes`, and the `routing_rules` column.

---

## Current State

### Migration Runner (`migrations/apply.js`)
```javascript
const SQL_FILES = [
  // ... 001 through 018 ...
  path.join(__dirname, './018_ticket_phases.sql'),
  // SKIPS 019, 022-028
  path.join(__dirname, './020_provider_configs.sql'),
  path.join(__dirname, './021_agent_heartbeats.sql'),
  path.join(__dirname, './029_provider_config_api_key.sql'),
  // ... 030, 031 ...
];
```

### Missing Migrations (on disk but not registered):
| File | Table/Column Created | Dependencies |
|------|---------------------|--------------|
| 022_review_diffs.sql | `review_diffs` table | `tickets` (FK) |
| 023_environments.sql | `environments` table | `projects` (FK) |
| 024_deployments.sql | `deployments` table | `tickets`, `environments` (FKs) |
| 025_milestones.sql | `milestones` table | `projects` (FK) |
| 026_ticket_milestone_fields.sql | `milestone_id`, `estimate`, `depends_on` on `tickets` | `milestones` (FK) |
| 027_compute_nodes.sql | `compute_nodes` table | `agents` (FK) |
| 028_routing_rules.sql | `routing_rules` JSONB on `project_providers` | `project_providers` (from 009) |

### Migration Dependency Graph
```
009 (project_providers) ──→ 028 (routing_rules)
023 (environments) ──────→ 024 (deployments)
025 (milestones) ────────→ 026 (ticket_milestone_fields)
022 (review_diffs) ────── independent (after 005 permissions)
027 (compute_nodes) ───── independent (after 002 agents)
```

---

## Design

### Option A: Insert in Dependency Order (Recommended)

Insert the missing migrations into `apply.js` at positions that respect their dependencies. The order should be:

```
001→002→003→004→005→022(review_diffs)→006→007→008→009→028(routing_rules)→010→013→014→011→012→015→016→017→018→020→021→023(environments)→024(deployments)→025(milestones)→026(ticket_milestone_fields)→027(compute_nodes)→029→030→031_expand→031_unify
```

This order ensures:
- 022 runs after 005 (permissions — review_diffs may need user FK)
- 028 runs after 009 (project_providers — routing_rules modifies this table)
- 023 runs before 024 (environments — deployments has FK to environments)
- 025 runs before 026 (milestones — ticket_milestone_fields has FK to milestones)
- 027 runs after 002 (agents — compute_nodes has FK to agents)

### Option B: Append at End

Append all missing migrations at the end of the list. Simpler but less logical — migrations run after later-numbered ones that may depend on them.

**Decision**: Option A is recommended because it maintains the logical dependency order and matches the expected migration sequence.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/apply.js` | MODIFY | Insert 022-028 at correct positions in SQL_FILES array |
| `AGENTS.md` | MODIFY | Update migration order in Architecture section |

---

## Data Flow Diagram

```
Fresh DB Setup:
  apply.js reads SQL_FILES array → executes each SQL file in order
    → Each file: CREATE TABLE IF NOT EXISTS → creates table if missing
    → If already exists: no-op (safe to re-run)
    → schema_migrations table (if exists): tracks applied versions
```

---

## Dependencies

- No new npm dependencies
- No database changes (existing migration files are used)
- No config changes

---

## Config / Environment Changes

- No new environment variables
- No config changes

---

## Security Considerations

- [x] No new endpoints or authentication changes
- [x] No sensitive data handling changes
- [x] All migrations use DDL only (no user input)

---

## Risks and Edge Cases

### Backend Risks
- **[Existing databases]**: For databases that already have 022-028 tables (via direct SQL), re-running should be safe due to `IF NOT EXISTS`. But if tables were created with different schemas, there could be conflicts. Mitigation: verify all migrations use `IF NOT EXISTS`.
- **[Migration 019 gap]**: The number 019 is skipped entirely. If a future migration depends on 019, there will be a gap. Mitigation: document the gap and consider creating 019 later.

### Edge Cases
- **[Rollback order]**: Rollback files should be applied in reverse order. Verify the rollback script handles 022-028 in reverse.
- **[schema_migrations table]**: If bp-61's `schema_migrations` table exists, new migrations should be tracked in it. Verify the apply.js version tracking handles the newly registered migrations.

---

## Alternative Designs Considered

### Alternative 1: Auto-discover migration files
- **Pros**: No manual ordering; new files are automatically picked up
- **Cons**: Loses control over migration order; `IF NOT EXISTS` may cause silent failures if dependencies aren't met
- **Decision**: Manual ordering in `apply.js` is safer and more explicit. Auto-discovery is a future improvement.

### Alternative 2: Create migration 019
- **Pros**: Fills the numbering gap
- **Cons**: No SQL file exists — we don't know what 019 was supposed to do
- **Decision**: Investigate 019 separately. Don't block 022-028 registration on creating 019.
