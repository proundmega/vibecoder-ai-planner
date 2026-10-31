# 03_ARCHITECT_IMPLEMENTATION.md — Migration Dry-Run Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Add Statement Classification

#### MODIFY: `backend/src/migrations/apply.js`

**Add classifyStatement function** (after splitSQLStatements):
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

### Phase 2: Add Dry-Run Mode

#### MODIFY: `backend/src/migrations/apply.js`

**Modify runMigration function** (add dry-run parameter):
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
      // NORMAL MODE: Execute statements
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

**Modify migrate function** (add dry-run parameter):
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

**Modify CLI argument parsing** (at bottom of file):
```javascript
// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (dryRun) {
  console.log('=== DRY-RUN MODE: No changes will be applied ===\n');
}

migrate(dryRun);
```

### Phase 3: Tests

#### CREATE: `backend/src/__tests__/migrationDryRun.test.js`

```javascript
const { classifyStatement } = require('../migrations/apply');

describe('classifyStatement', () => {
  it('classifies CREATE statements', () => {
    expect(classifyStatement('CREATE TABLE users (id SERIAL)')).toBe('CREATE');
  });

  it('classifies ALTER statements', () => {
    expect(classifyStatement('ALTER TABLE users ADD COLUMN email VARCHAR(255)')).toBe('ALTER');
  });

  it('classifies DROP statements', () => {
    expect(classifyStatement('DROP TABLE users')).toBe('DROP');
  });

  it('classifies INSERT statements', () => {
    expect(classifyStatement('INSERT INTO users (name) VALUES (\'test\')')).toBe('INSERT');
  });

  it('classifies UPDATE statements', () => {
    expect(classifyStatement('UPDATE users SET name = \'test\'')).toBe('UPDATE');
  });

  it('classifies DELETE statements', () => {
    expect(classifyStatement('DELETE FROM users WHERE id = 1')).toBe('DELETE');
  });

  it('classifies COMMENT statements', () => {
    expect(classifyStatement('COMMENT ON COLUMN users.email IS \'Email\'')).toBe('COMMENT');
  });

  it('classifies unknown statements as OTHER', () => {
    expect(classifyStatement('BEGIN')).toBe('OTHER');
    expect(classifyStatement('COMMIT')).toBe('OTHER');
  });

  it('is case-insensitive', () => {
    expect(classifyStatement('create table users (id SERIAL)')).toBe('CREATE');
    expect(classifyStatement('Create Table Users (Id Serial)')).toBe('CREATE');
  });
});
```

### Phase 4: npm Script

#### MODIFY: `backend/package.json`

**Add script**:
```json
"db:migrate:dry-run": "node src/migrations/apply.js --dry-run"
```

---

## Files Changed

```
backend/src/migrations/apply.js                                   → MODIFY (add dry-run mode)
backend/package.json                                              → MODIFY (add dry-run script)
backend/src/__tests__/migrationDryRun.test.js                     → CREATE
```

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

Common goldmine categories:
- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] `npm run db:migrate -- --dry-run` runs without errors
5. [ ] Dry-run output shows statement classification
6. [ ] Dry-run output shows summary
7. [ ] Dry-run does NOT modify database
8. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
