# 02_ARCHITECT_DESIGN.md — Migration Dry-Run Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Running migrations has no preview mode. In production, a bad migration could corrupt data or break the schema. There's no way to see what changes would be made before applying them.

---

## Current State

### Existing Backend
- `backend/src/migrations/apply.js` — runs SQL files in order from SQL_FILES array
- `splitSQLStatements()` — parses SQL into individual statements
- `runMigration()` — executes each statement with `pool.query(stmt)`
- Errors are caught and logged (non-fatal, migration continues)
- No dry-run or preview mode

### Gap Analysis
- No way to preview migrations before applying
- No statement classification (CREATE, ALTER, DROP, etc.)
- No summary of changes

---

## Design

### Option A: Dry-Run with Statement Classification (Recommended)

```
apply.js changes:
  → Add --dry-run CLI flag
  → In dry-run mode:
    → Parse SQL into statements (existing splitSQLStatements)
    → Classify each statement (CREATE/ALTER/DROP/INSERT/UPDATE/DELETE/OTHER)
    → Show what would happen without executing
    → Report summary of changes
  → In normal mode: unchanged behavior
```

### Option B: Dry-Run with EXPLAIN
- Use `EXPLAIN` for DML statements to show affected rows
- More detailed but complex (EXPLAIN doesn't work for all DDL)
- Would require DB connection even for syntax validation

### Option C: Dry-Run with Text Parsing Only
- No DB connection needed
- Only classifies statements by keyword (CREATE, ALTER, etc.)
- Cannot validate SQL syntax
- Less reliable but safer (no DB access needed)

**Decision**: Option A — dry-run with statement classification. Simple, no DB connection needed for basic preview, can add EXPLAIN later if needed.

---

## Statement Classification

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

---

## Dry-Run Output Format

```
--- 001_create_tables.sql (15 statements) ---
[DRY-RUN] Would execute 15 statements:
  [CREATE] CREATE TABLE users (...)
  [CREATE] CREATE TABLE projects (...)
  [CREATE] CREATE TABLE tickets (...)
  [ALTER] ALTER TABLE tickets ADD COLUMN assignee_id INTEGER
  [COMMENT] COMMENT ON COLUMN users.email IS 'User email address'
  ...

Summary:
  CREATE: 3
  ALTER: 1
  COMMENT: 1
  OTHER: 10

Total: 15 statements would be executed.
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/migrationDryRun.test.js` | Statement classification, dry-run output |

---

## Risks and Edge Cases

### Backend Risks
- **[Multi-statement files]**: Some SQL files have multiple statements separated by `;` — Mitigation: `splitSQLStatements()` already handles this
- **[Dollar-quoted strings]**: SQL with `$$` or `$tag$` — Mitigation: `splitSQLStatements()` already handles this
- **[Comments]**: SQL with comments containing SQL keywords — Mitigation: `splitSQLStatements()` strips comments before parsing

### Edge Cases
- **[Empty statements]**: Files with only comments — Handle: Skip, don't count
- **[Complex DDL]**: CREATE TABLE with constraints, indexes — Handle: Classify as CREATE, don't parse inner statements
- **[Transaction blocks]**: BEGIN/COMMIT/ROLLBACK — Handle: Classify as OTHER, don't execute in dry-run

---

## Alternative Designs Considered

### Alternative 1: Dry-Run with EXPLAIN
- **Pros**: More detailed (shows affected rows for DML)
- **Cons**: EXPLAIN doesn't work for all DDL, requires DB connection
- **Decision**: Statement classification is simpler and sufficient

### Alternative 2: Dry-Run with Text Parsing Only
- **Pros**: No DB connection needed
- **Cons**: Cannot validate SQL syntax, less reliable
- **Decision**: Option A is a good balance (no DB needed for basic preview)

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

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
