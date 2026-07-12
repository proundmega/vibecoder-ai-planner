# 03_ARCHITECT_IMPLEMENTATION.md — CSP Violation Reporting Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Database Migration

#### CREATE: `backend/src/migrations/XXX_create_csp_violations.sql`

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

#### CREATE: `backend/src/migrations/XXX_create_csp_violations_rollback.sql`

```sql
DROP INDEX IF EXISTS idx_csp_violations_created_at;
DROP INDEX IF EXISTS idx_csp_violations_directive;
DROP TABLE IF EXISTS csp_violations;
```

### Phase 2: Backend — Persist Violations

#### MODIFY: `backend/src/api/csp-report.js`

**Add import**:
```javascript
const { pool } = require('../db');
```

**Modify POST handler** (after logging):
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

### Phase 3: Backend — New API Router

#### CREATE: `backend/src/api/csp-violations.js`

```javascript
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { verifyToken } = require('../middleware/auth');

/**
 * @openapi
 * /v1/csp-violations:
 *   get:
 *     tags: [System]
 *     summary: List CSP violations
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: directive
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated list of CSP violations
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const directive = req.query.directive;
    
    let whereClause = '';
    const params = [];
    
    if (directive) {
      whereClause = 'WHERE violated_directive = $1';
      params.push(directive);
    }
    
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM csp_violations ${whereClause}`,
      params
    );
    
    const total = parseInt(countResult.rows[0].count);
    
    const selectParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT id, violated_directive, blocked_uri, document_uri, referrer, created_at
       FROM csp_violations ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      selectParams
    );
    
    res.json({
      success: true,
      data: {
        violations: result.rows,
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v1/csp-violations:
 *   delete:
 *     tags: [System]
 *     summary: Clear all CSP violations
 *     responses:
 *       200:
 *         description: All violations cleared
 */
router.delete('/', verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM csp_violations');
    res.json({
      success: true,
      data: {
        deletedCount: result.rowCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

### Phase 4: Backend — Cleanup Job

#### CREATE: `backend/src/services/CspViolationCleanupService.js`

```javascript
const { pool } = require('../db');
const logger = require('../utils/logger');

class CspViolationCleanupService {
  async cleanup() {
    const result = await pool.query(
      'DELETE FROM csp_violations WHERE created_at < NOW() - INTERVAL \'30 days\''
    );
    if (result.rowCount > 0) {
      logger.info(`CSP violation cleanup: deleted ${result.rowCount} violations older than 30 days`);
    }
  }
}

module.exports = new CspViolationCleanupService();
```

#### MODIFY: `backend/src/index.js`

**Add cleanup job** (after other scheduled jobs):
```javascript
const CspViolationCleanupService = require('./services/CspViolationCleanupService');

// Run cleanup every hour
setInterval(() => {
  CspViolationCleanupService.cleanup().catch(err => {
    logger.error('CSP violation cleanup failed', err);
  });
}, 3600000).unref();
```

### Phase 5: Backend — Mount Route

#### MODIFY: `backend/src/api/v1/index.js`

**Add import and mount**:
```javascript
const cspViolationsRouter = require('../csp-violations');
// ...
router.use('/csp-violations', cspViolationsRouter);
```

### Phase 6: Frontend — API Client

#### CREATE: `frontend/src/api/cspViolations.ts`

```typescript
import { get, del } from './client';

export interface CspViolation {
  id: number;
  violated_directive: string;
  blocked_uri: string;
  document_uri: string;
  referrer: string;
  created_at: string;
}

export interface CspViolationsResponse {
  violations: CspViolation[];
  total: number;
  limit: number;
  offset: number;
}

export async function getCspViolations(params: {
  limit?: number;
  offset?: number;
  directive?: string;
}): Promise<CspViolationsResponse> {
  const response = await get('/csp-violations', { params });
  return response.data.data;
}

export async function clearCspViolations(): Promise<{ deletedCount: number }> {
  const response = await del('/csp-violations');
  return response.data.data;
}
```

### Phase 7: Frontend — View

#### CREATE: `frontend/src/views/CspViolations.vue`

**Template**:
```vue
<template>
  <div class="csp-violations">
    <h2>CSP Violations</h2>
    
    <div class="filters">
      <select v-model="filterDirective">
        <option value="">All Directives</option>
        <option value="script-src">script-src</option>
        <option value="style-src">style-src</option>
        <option value="img-src">img-src</option>
        <option value="connect-src">connect-src</option>
        <option value="default-src">default-src</option>
      </select>
      <button @click="loadViolations">Filter</button>
      <button @click="clearAll" class="danger">Clear All</button>
    </div>
    
    <table v-if="violations.length">
      <thead>
        <tr>
          <th>Date</th>
          <th>Directive</th>
          <th>Blocked URI</th>
          <th>Document</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in violations" :key="v.id">
          <td>{{ formatDate(v.created_at) }}</td>
          <td><code>{{ v.violated_directive }}</code></td>
          <td><code class="truncate" :title="v.blocked_uri">{{ v.blocked_uri }}</code></td>
          <td><code class="truncate" :title="v.document_uri">{{ v.document_uri }}</code></td>
        </tr>
      </tbody>
    </table>
    
    <p v-else class="empty">No violations found.</p>
    
    <div v-if="total > limit" class="pagination">
      <button @click="prevPage" :disabled="offset === 0">Previous</button>
      <span>Page {{ Math.floor(offset / limit) + 1 }} of {{ Math.ceil(total / limit) }}</span>
      <button @click="nextPage" :disabled="offset + limit >= total">Next</button>
    </div>
  </div>
</template>
```

**Script**:
```typescript
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getCspViolations, clearCspViolations, CspViolation } from '@/api/cspViolations';

const violations = ref<CspViolation[]>([]);
const total = ref(0);
const limit = ref(20);
const offset = ref(0);
const filterDirective = ref('');
const loading = ref(false);

async function loadViolations() {
  loading.value = true;
  try {
    const params: any = {
      limit: limit.value,
      offset: offset.value,
    };
    if (filterDirective.value) {
      params.directive = filterDirective.value;
    }
    const response = await getCspViolations(params);
    violations.value = response.violations;
    total.value = response.total;
  } finally {
    loading.value = false;
  }
}

function prevPage() {
  offset.value = Math.max(0, offset.value - limit.value);
  loadViolations();
}

function nextPage() {
  offset.value += limit.value;
  loadViolations();
}

async function clearAll() {
  if (!confirm('Clear all CSP violations? This cannot be undone.')) return;
  try {
    await clearCspViolations();
    violations.value = [];
    total.value = 0;
  } catch (error) {
    // Show error
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

onMounted(loadViolations);
</script>
```

**CSS**:
```css
.csp-violations {
  padding: 1rem;
}

.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.filters select {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
}

.danger {
  background: #ef4444;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  cursor: pointer;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

th {
  background: #f9fafb;
  font-weight: 600;
}

code {
  font-family: monospace;
  font-size: 0.875rem;
  background: #f3f4f6;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
}

.truncate {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}

.pagination button {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty {
  text-align: center;
  color: #6b7280;
  padding: 2rem;
}
```

### Phase 8: Frontend — Router

#### MODIFY: `frontend/src/router/index.ts`

**Add route**:
```typescript
{
  path: 'settings/csp-violations',
  name: 'CspViolations',
  component: () => import('@/views/CspViolations.vue'),
  meta: { requiresAuth: true }
}
```

### Phase 9: Tests

#### CREATE: `backend/src/__tests__/cspViolations.test.js`
```javascript
const request = require('supertest');
const app = require('src/index');

describe('GET /api/v1/csp-violations', () => {
  it('returns paginated violations', async () => {
    // TODO: insert test violation, GET, verify response
  });

  it('filters by directive', async () => {
    // TODO: insert violations, filter by script-src, verify
  });

  it('returns 401 without auth', async () => {
    // TODO: GET without token
  });
});

describe('DELETE /api/v1/csp-violations', () => {
  it('clears all violations', async () => {
    // TODO: insert violations, DELETE, verify empty
  });
});
```

#### CREATE: `frontend/src/__tests__/cspViolations.test.ts`
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CspViolations from '@/views/CspViolations.vue';
import * as cspApi from '@/api/cspViolations';

describe('CspViolations.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads violations on mount', async () => {
    // TODO: mount, verify API called
  });

  it('displays violations in table', async () => {
    // TODO: mount with mock data, verify table content
  });

  it('filters by directive', async () => {
    // TODO: select directive, verify API called with filter
  });

  it('clears all violations on confirm', async () => {
    // TODO: click clear, confirm, verify API called
  });

  it('paginates correctly', async () => {
    // TODO: click next page, verify offset updated
  });
});
```

---

## Files Changed

```
backend/src/migrations/XXX_create_csp_violations.sql                        → CREATE
backend/src/migrations/XXX_create_csp_violations_rollback.sql              → CREATE
backend/src/api/csp-report.js                                              → MODIFY (persist to DB)
backend/src/api/csp-violations.js                                          → CREATE
backend/src/api/v1/index.js                                                → MODIFY (mount router)
backend/src/services/CspViolationCleanupService.js                         → CREATE
backend/src/index.js                                                       → MODIFY (add cleanup job)
frontend/src/views/CspViolations.vue                                       → CREATE
frontend/src/api/cspViolations.ts                                          → CREATE
frontend/src/router/index.ts                                               → MODIFY (add route)
backend/src/__tests__/cspViolations.test.js                                → CREATE
frontend/src/__tests__/cspViolations.test.ts                               → CREATE
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
4. [ ] Frontend: `npm run lint` passes
5. [ ] Frontend: `npm run typecheck` passes
6. [ ] Frontend: `npm run build` passes
7. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
8. [ ] CSP violations are persisted to DB
9. [ ] Frontend page displays violations correctly
10. [ ] Cleanup job runs every hour
11. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
