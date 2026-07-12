# 01_ARCHITECT_REQUIREMENT.md — Migration Dry-Run Mode

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P2 (Developer Experience)
**Effort**: Small

---

## Requirement

Add a dry-run mode to the migration runner that previews what changes would be made without applying them. Currently, `npm run db:migrate` applies all migrations immediately with no way to preview. This is risky in production where a bad migration could corrupt data.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Migration runner exists: `backend/src/migrations/apply.js` — runs SQL files in order
- [x] Each SQL file has a `_rollback.sql` counterpart
- [x] `splitSQLStatements()` function parses SQL into individual statements
- [x] Run errors are caught and logged (non-fatal)

### Key Insight

The migration runner already parses SQL into statements. Adding dry-run requires:
1. Add `--dry-run` flag to apply.js
2. In dry-run mode, explain/analyze each statement instead of executing
3. For DDL statements (CREATE, ALTER, DROP), use `EXPLAIN` or parse statement type
4. For DML statements (INSERT, UPDATE, DELETE), use `EXPLAIN` to show affected rows
5. Report summary: X statements would be executed, Y CREATE, Z ALTER, etc.

---

## Scope

### In Scope
- Add `--dry-run` CLI flag to `apply.js`
- In dry-run mode: parse SQL, classify statements (CREATE/ALTER/DROP/INSERT/UPDATE/DELETE/OTHER)
- In dry-run mode: show what would happen without executing
- In dry-run mode: report summary of changes
- In dry-run mode: still validate SQL syntax (catch errors before applying)
- Tests: unit tests for dry-run mode

### Out of Scope
- Dry-run for data migrations (JavaScript files)
- Dry-run with rollback preview
- Dry-run with dependency analysis (migration order)
- Dry-run with impact analysis (which tables/columns affected)

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/apply.js` | MODIFY | Add `--dry-run` flag and preview logic |
| `backend/src/__tests__/migrationDryRun.test.js` | CREATE | Unit tests for dry-run mode |

---

## Known Unknowns

1. **How to validate SQL without executing?** — Assumed: Use `EXPLAIN` for DML, parse statement type for DDL. Some statements (CREATE INDEX CONCURRENTLY) may not work with EXPLAIN.
2. **Should dry-run connect to DB?** — Assumed YES (to validate SQL syntax and get EXPLAIN plans). Without DB connection, we can only do text parsing.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Dry-run requires DB connection?** — YES (to validate SQL) — or NO (text-only parsing)? — {{YES / NO}}
2. **Dry-run for data migrations?** — NO (deferred) — or YES (preview JS execution)? — {{NO / YES}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend] `npm run db:migrate -- --dry-run` runs in dry-run mode
2. [ ] [Backend] Dry-run shows what statements would be executed
3. [ ] [Backend] Dry-run reports summary (X CREATE, Y ALTER, Z DROP, etc.)
4. [ ] [Backend] Dry-run validates SQL syntax (catches errors)
5. [ ] [Backend] Dry-run does NOT modify database
6. [ ] [Tests] Unit tests for dry-run mode
7. [ ] [Coverage] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Dry-run for data migrations (JavaScript files)
- Dry-run with rollback preview
- Dry-run with dependency analysis
- Dry-run with impact analysis

---

## Performance Considerations

- Expected load: Minimal — dry-run runs once per deployment
- EXPLAIN plans are cheap for DDL statements
- No blocking I/O in dry-run

---

## Security Considerations

- [ ] Dry-run does not modify any data
- [ ] Dry-run still requires DATABASE_URL (reads from .env)
- [ ] No sensitive data exposed in output

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/migrationDryRun.test.js` — test dry-run mode
- [ ] Test statement classification (CREATE, ALTER, DROP, etc.)
- [ ] Test summary report generation
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
