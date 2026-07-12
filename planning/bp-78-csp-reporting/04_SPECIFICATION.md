# 04_SPECIFICATION.md — CSP Violation Reporting Execution Spec

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

### CREATE: `backend/src/migrations/XXX_create_csp_violations.sql`

**Contents**:
```sql
CREATE TABLE csp_violations (
  id SERIAL PRIMARY KEY,
  violated_directive VARCHAR(255),
  blocked_uri VARCHAR(1024),
  document_uri VARCHAR(1024),
  referrer VARCHAR(1024),
  original_policy TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_csp_violations_created_at ON csp_violations(created_at DESC);
CREATE INDEX idx_csp_violations_directive ON csp_violations(violated_directive);
```

### CREATE: `backend/src/migrations/XXX_create_csp_violations_rollback.sql`

**Contents**:
```sql
DROP INDEX IF EXISTS idx_csp_violations_created_at;
DROP INDEX IF EXISTS idx_csp_violations_directive;
DROP TABLE IF EXISTS csp_violations;
```

### MODIFY: `backend/src/api/csp-report.js`

**Add import**:
```javascript
const { pool } = require('../db');
```

**Modify POST handler** (replace existing handler):
```javascript
router.post('/csp-report', async (req, res, next) => {
  try {
    const report = req.body;
    logger.warn('CSP Violation Report:', JSON.stringify(report, null, 2));
    
    // Persist to DB
    const cspReport = report['csp-report'] || report;
    if (cspReport) {
      await pool.query(
        `INSERT INTO csp_violations (violated_directive, blocked_uri, document_uri, referrer, original_policy)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          cspReport['violated-directive'] || null,
          cspReport['blocked-uri'] || null,
          cspReport['document-uri'] || null,
          cspReport['referrer'] || null,
          cspReport['original-policy'] || null,
        ]
      );
    }
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
```

### CREATE: `backend/src/api/csp-violations.js`

**Full file** (see 03_ARCHITECT_IMPLEMENTATION.md for complete code)

### MODIFY: `backend/src/api/v1/index.js`

**Add import and mount** (after other imports and routes):
```javascript
const cspViolationsRouter = require('../csp-violations');
// ...
router.use('/csp-violations', cspViolationsRouter);
```

### CREATE: `backend/src/services/CspViolationCleanupService.js`

**Full file** (see 03_ARCHITECT_IMPLEMENTATION.md for complete code)

### MODIFY: `backend/src/index.js`

**Add import** (after other service imports):
```javascript
const CspViolationCleanupService = require('./services/CspViolationCleanupService');
```

**Add cleanup job** (after other scheduled jobs):
```javascript
// Run CSP violation cleanup every hour
setInterval(() => {
  CspViolationCleanupService.cleanup().catch(err => {
    logger.error('CSP violation cleanup failed', err);
  });
}, 3600000).unref();
```

### CREATE: `frontend/src/api/cspViolations.ts`

**Full file** (see 03_ARCHITECT_IMPLEMENTATION.md for complete code)

### CREATE: `frontend/src/views/CspViolations.vue`

**Full file** (see 03_ARCHITECT_IMPLEMENTATION.md for complete code)

### MODIFY: `frontend/src/router/index.ts`

**Add route** (in routes array):
```typescript
{
  path: 'settings/csp-violations',
  name: 'CspViolations',
  component: () => import('@/views/CspViolations.vue'),
  meta: { requiresAuth: true }
}
```

### CREATE: `backend/src/__tests__/cspViolations.test.js`

**Imports**:
```javascript
const request = require('supertest');
const app = require('src/index');
```

**Test stubs**:
```javascript
describe('GET /api/v1/csp-violations', () => {
  it('returns paginated violations', async () => {
    // TODO: implement
  });

  it('filters by directive', async () => {
    // TODO: implement
  });

  it('returns 401 without auth', async () => {
    // TODO: implement
  });
});

describe('DELETE /api/v1/csp-violations', () => {
  it('clears all violations', async () => {
    // TODO: implement
  });
});
```

### CREATE: `frontend/src/__tests__/cspViolations.test.ts`

**Imports**:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CspViolations from '@/views/CspViolations.vue';
import * as cspApi from '@/api/cspViolations';
```

**Test stubs**:
```typescript
describe('CspViolations.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads violations on mount', async () => {
    // TODO: implement
  });

  it('displays violations in table', async () => {
    // TODO: implement
  });

  it('filters by directive', async () => {
    // TODO: implement
  });

  it('clears all violations on confirm', async () => {
    // TODO: implement
  });

  it('paginates correctly', async () => {
    // TODO: implement
  });
});
```

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — CSP Violations
```
✓ [happy] GET /api/v1/csp-violations returns paginated list
✓ [happy] GET /api/v1/csp-violations with directive filter returns filtered results
✓ [error] GET /api/v1/csp-violations without auth returns 401
✓ [happy] DELETE /api/v1/csp-violations clears all violations
✓ [edge] GET returns empty list when no violations exist
✓ [edge] Pagination returns correct total count
```

### Frontend Unit Tests — CspViolations.vue
```
✓ [ui] Component loads violations on mount
✓ [ui] Violations displayed in table with correct columns
✓ [ui] Filter dropdown changes directive filter
✓ [ui] Clear All button shows confirmation dialog
✓ [ui] Pagination buttons work correctly
✓ [ui] Empty state shown when no violations
✓ [ui] Long URIs are truncated with tooltip
```

---

## Edge Cases to Handle

1. **[blocked_uri is "inline"]**: Some browsers report "inline" for inline scripts — Handle: Display as-is
2. **[blocked_uri is "(no-referrer)"]**: Handle: Display as-is
3. **[original_policy is null]**: Handle: Display "N/A" or omit from display
4. **[Large datasets]**: 1000+ violations — Handle: Pagination (20 per page)
5. **[Long URIs]**: blocked_uri or document_uri exceeds display — Handle: CSS truncate with title tooltip

---

## Existing Code Patterns to Follow

- Use `pool.query()` with parameterized queries (no SQL injection)
- Error format: `{ success: false, error: { code, message } }`
- Frontend: `<script setup>` syntax, not Options API
- Frontend: Import from `@/stores/` not relative paths
- Frontend: Error messages in English, no i18n wrappers
- Backend: JSDoc annotations for OpenAPI spec generation
- Tests: Use `jest.mock()` for database dependencies in unit tests

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

- `backend/src/middleware/` — no middleware changes
- `frontend/src/stores/` — no store changes
- `docker-compose.yml` — no infrastructure changes
- `backend/src/controllers/` — no controller changes

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
