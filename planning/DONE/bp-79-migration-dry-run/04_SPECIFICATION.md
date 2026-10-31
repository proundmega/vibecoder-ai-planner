# 04_SPECIFICATION.md — Migration Dry-Run Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-12

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code. Do not defer test creation to a later step.

---

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create, modify, or delete any file not listed here.

### MODIFY: `backend/src/migrations/apply.js`

**Add classifyStatement function** (after splitSQLStatements function):
```javascript
function classifyStatement(sql) {
  const trimmed = sql.trim().toUpperCase();
  
  if (trimmed.startsWith('CREATE')) return 'CREATE';
  if (trimmed.startsWith('ALTER')) return 'ALTER';
  if (trimmed.startsWith('DROP')) return 'DROP';
  if (trimmed.startsWith('TRUNCATE')) return 'TRUNCATE';
  if (trimmed.startsWith('INSERT')) return 'INSERT';
  if (trimmed.startsWith('UPDATE')) return 'UPDATE';
  if (trimmed.startsWith('DELETE')) return 'DELETE';
  if (trimmed.startsWith('COMMENT')) return 'COMMENT';
  if (trimmed.startsWith('GRANT')) return 'GRANT';
  if (trimmed.startsWith('REVOKE')) return 'REVOKE';
  
  return 'OTHER';
}
```

**Modify runMigration function** (add dryRun parameter):
```javascript
async function runMigration(file, dryRun = false) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    family: 4,
  });

  try {
    await pool.query('SELECT NOW()');

    const sql = fs.readFileSync(file, 'utf8');
    const statements = splitSQLStatements(sql);

    console.log(`\n--- ${path.basename(file)} (${statements.length} statements) ---`);

    if (dryRun) {
      // DRY-RUN MODE: Don't execute, just classify and report
      const summary = {};
      
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const trimmed = stmt.trim();
        
        if (!trimmed) continue; // Skip empty statements
        
        const type = classifyStatement(stmt);
        summary[type] = (summary[type] || 0) + 1;
        
        // Show first 100 chars of statement (truncated)
        const preview = trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
        console.log(`  [${type}] ${preview}`);
      }
      
      console.log('\nSummary:');
      for (const [type, count] of Object.entries(summary).sort()) {
        console.log(`  ${type}: ${count}`);
      }
      console.log(`\nTotal: ${Object.values(summary).reduce((a, b) => a + b, 0)} statements would be executed.`);
    } else {
      // NORMAL MODE: Execute statements (unchanged)
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          await pool.query(stmt);
          console.log(`  ✓ Statement ${i + 1} executed`);
        } catch (err) {
          console.log(`  ! Statement ${i + 1} (may already exist): ${err.message}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error in ${path.basename(file)}:`, error.message);
  } finally {
    await pool.end();
  }
}
```

**Modify migrate function** (add dryRun parameter):
```javascript
async function migrate(dryRun = false) {
  for (const sqlFile of SQL_FILES) {
    await runMigration(sqlFile, dryRun);
  }

  for (const dataMigration of DATA_MIGRATIONS) {
    if (dryRun) {
      console.log(`\n[DRY-RUN] Would run data migration: ${path.basename(dataMigration)}`);
    } else {
      await runDataMigration(dataMigration);
    }
  }

  console.log('\n\n✓ Migrations completed successfully!');
}
```

**Add CLI argument parsing** (at bottom of file, before migrate() call):
```javascript
// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (dryRun) {
  console.log('=== DRY-RUN MODE: No changes will be applied ===\n');
}

migrate(dryRun);
```

### MODIFY: `backend/package.json`

**Add script**:
```json
"db:migrate:dry-run": "node src/migrations/apply.js --dry-run"
```

### CREATE: `backend/src/__tests__/migrationDryRun.test.js`

**Imports**:
```javascript
// Note: apply.js is a CLI script, not a module.
// We need to extract classifyStatement for testing.
// Option 1: Export classifyStatement from apply.js
// Option 2: Create a separate utils file for classifyStatement
// For simplicity, we'll test via CLI output using child_process
```

**Test stubs**:
```javascript
const { execSync } = require('child_process');
const path = require('path');

describe('Migration Dry-Run', () => {
  it('classifyStatement classifies CREATE correctly', () => {
    // TODO: test via require or CLI
  });

  it('classifyStatement classifies ALTER correctly', () => {
    // TODO: test via require or CLI
  });

  it('classifyStatement classifies DROP correctly', () => {
    // TODO: test via require or CLI
  });

  it('classifyStatement is case-insensitive', () => {
    // TODO: test via require or CLI
  });

  it('dry-run mode does not modify database', () => {
    // TODO: run --dry-run, verify no changes
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — Migration Dry-Run
```
✓ [happy] classifyStatement('CREATE TABLE...') returns 'CREATE'
✓ [happy] classifyStatement('ALTER TABLE...') returns 'ALTER'
✓ [happy] classifyStatement('DROP TABLE...') returns 'DROP'
✓ [happy] classifyStatement('INSERT INTO...') returns 'INSERT'
✓ [happy] classifyStatement('UPDATE...') returns 'UPDATE'
✓ [happy] classifyStatement('DELETE FROM...') returns 'DELETE'
✓ [happy] classifyStatement('COMMENT ON...') returns 'COMMENT'
✓ [happy] classifyStatement('BEGIN') returns 'OTHER'
✓ [edge] classifyStatement is case-insensitive
✓ [edge] classifyStatement handles leading whitespace
```

---

## Edge Cases to Handle

1. **[Empty statements]**: Files with only comments — Handle: Skip, don't count
2. **[Complex DDL]**: CREATE TABLE with constraints, indexes — Handle: Classify as CREATE, don't parse inner statements
3. **[Transaction blocks]**: BEGIN/COMMIT/ROLLBACK — Handle: Classify as OTHER, don't execute in dry-run
4. **[Dollar-quoted strings]**: SQL with `$$` — Handle: splitSQLStatements already handles this
5. **[Multi-line statements]**: Statements spanning multiple lines — Handle: splitSQLStatements already handles this

---

## Existing Code Patterns to Follow

- Use existing `splitSQLStatements()` function for parsing
- Follow existing console.log format in apply.js
- CLI arguments parsed from `process.argv.slice(2)`
- Tests use Jest with require/import

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `frontend/src/` — no frontend changes
- `backend/src/api/` — no API changes
- `backend/src/services/` — no service changes
- `docker-compose.yml` — no infrastructure changes

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
