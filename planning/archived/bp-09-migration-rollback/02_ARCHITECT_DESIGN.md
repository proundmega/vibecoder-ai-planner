# 02_ARCHITECT_DESIGN.md — Migration Rollback

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

Migrations are ad-hoc SQL files with no rollback support. If a migration fails or causes issues, there's no way to undo it.

---

## Current State

```
src/migrations/
  001_create_tables.sql
  002_agents_schema.sql
  ...
  015_shared_agent_memory.sql
```

No migration tracking. No rollback. No versioning.

---

## Design

### Migration Tracking Table

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);
```

### Rollback Script

```javascript
// backend/src/migrations/rollback.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function rollback(targetVersion) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Get applied migrations in reverse order up to target
    const { rows } = await pool.query(
      'SELECT version, name FROM _migrations WHERE version <= $1 ORDER BY version DESC',
      [targetVersion]
    );
    
    for (const migration of rows) {
      const rollbackPath = path.join(__dirname, `${migration.version}_${migration.name}_rollback.sql`);
      
      if (!fs.existsSync(rollbackPath)) {
        throw new Error(`Rollback SQL not found for migration ${migration.version}_${migration.name}`);
      }
      
      const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');
      
      await pool.query('BEGIN');
      await pool.query(rollbackSql);
      await pool.query('DELETE FROM _migrations WHERE version = $1', [migration.version]);
      await pool.query('COMMIT');
      
      console.log(`Rolled back migration ${migration.version}`);
    }
    
    console.log(`Rollback to version ${targetVersion} complete`);
  } finally {
    await pool.end();
  }
}

module.exports = { rollback };
```

### Rollback SQL Files

```
src/migrations/
  001_create_tables.sql
  001_create_tables_rollback.sql
  002_agents_schema.sql
  002_agents_schema_rollback.sql
  ...
  015_shared_agent_memory.sql
  015_shared_agent_memory_rollback.sql
```

### CLI Commands

```bash
# Rollback last migration
npm run db:rollback:latest

# Rollback specific migration
npm run db:rollback -- 003

# Rollback to specific version
npm run db:rollback -- 005
```

### Alternative Designs Considered

- **Knex.js over custom rollback** — Chose custom rollback script over Knex.js because: it adds zero new dependencies and integrates directly with the existing migration pattern. Knex.js was considered but rejected because: it is a full migration framework that would require rewriting all 15 migration files, adding a new dependency, and creating a learning curve for the team.
- **Database-level migration tracking (pgmigrate)** — Chose custom `_migrations` table over `pgmigrate` because: it is simpler, requires no external tooling, and can be extended with custom rollback logic. `pgmigrate` was considered but rejected because: it has its own file naming conventions, migration ordering rules, and requires a CLI tool that may not be available in all environments.
- **Down migration files vs rollback files** — Chose `_rollback.sql` suffix over `_down.sql` suffix because: it is more explicit about the purpose (rollback, not just the inverse) and avoids confusion with the concept of "down migrations" in other tools. Down file naming was considered but rejected because: `_down.sql` is less clear about intent and may conflict with other tooling conventions.

### Data Flow Diagram

```
npm run db:rollback -- 005
    ↓
[rollback.js] → connect to DB
    ↓
[SELECT * FROM _migrations WHERE version <= 5 ORDER BY version DESC]
    ↓
  [5, 4, 3, 2, 1] (reverse order)
    ↓
  for each migration:
    ↓
  [check rollback file exists?]
    ├─ No → throw error
    └─ Yes → BEGIN
              ↓
          [execute rollback SQL]
              ↓
          [DELETE FROM _migrations WHERE version = N]
              ↓
          COMMIT
    ↓
[rollback complete]
```

### Config / Env Changes

- NEW: `backend/src/migrations/rollback.js` — rollback script with transaction support
- NEW: `backend/package.json` — add `db:rollback`, `db:rollback:latest` npm scripts
- NEW: `backend/.env.example` — add `ROLLBACK_TRANSACTION=true` (safety flag)
- NEW: `src/migrations/*_rollback.sql` — one rollback file per existing migration (15 files)
- CHANGED: `src/migrations/apply.js` — optionally create `_migrations` table and track applied versions

---

## Dependencies

- **None** — self-contained change
- **Existing migrations** — need corresponding rollback SQL files

---

## Risks/Edge Cases

- **[Data loss]**: Rollback may drop data. Document what data is lost in rollback SQL comments.
- **[Partial rollback]**: If rollback fails mid-way, DB is in inconsistent state. Use transactions.
- **[Missing rollback file]**: If rollback SQL doesn't exist, rollback should fail with clear error.
- **[Rollback of rollback]**: If a rollback migration itself drops a table, running it again (accidentally) is a no-op. Document idempotency in rollback SQL.

---

*Ready for implementation phase.*
