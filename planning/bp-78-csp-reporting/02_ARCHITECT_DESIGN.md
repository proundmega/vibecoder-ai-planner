# 02_ARCHITECT_DESIGN.md — CSP Violation Reporting Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

CSP violations are logged to file but not persisted or viewable. When browsers block resources due to CSP violations, the reports are sent to the backend but only appear in log files. There's no way to monitor, analyze, or act on these violations.

---

## Current State

### Existing Backend
- `POST /api/csp-report` — accepts CSP violation reports, logs to Winston
- CSP headers set via helmet middleware
- No database storage for violations
- No frontend UI to view violations
- No cleanup job for old violations

### Gap Analysis
- Violations not persisted (lost on restart)
- No API to query violations
- No frontend UI to view violations
- No retention policy (logs grow unbounded)

---

## Design

### Option A: DB Storage + Frontend UI (Recommended)

```
Database:
  backend/src/migrations/XXX_create_csp_violations.sql
    → CREATE TABLE csp_violations (id, violated_directive, blocked_uri, document_uri, referrer, original_policy, created_at)

CSP Report Endpoint:
  backend/src/api/csp-report.js
    → INSERT violation into DB (after logging)

New API Router:
  backend/src/api/csp-violations.js
    → GET /api/v1/csp-violations — list violations (paginated, sorted by created_at DESC)
    → DELETE /api/v1/csp-violations — clear all violations

Cleanup Job:
  backend/src/services/CspViolationCleanupService.js
    → Delete violations older than 30 days
    → Run every hour via setInterval

Frontend:
  frontend/src/views/CspViolations.vue — new view in Settings
  frontend/src/api/cspViolations.js — API client
  frontend/src/router/index.ts — add route
```

### Option B: Log File Parsing
- Parse Winston log files for violations
- No database changes
- More complex parsing, slower queries
- Would require log rotation awareness

### Option C: External Storage (Elasticsearch)
- Send violations to Elasticsearch
- Powerful search/aggregation
- Adds new dependency, overkill for this use case
- Deferred to bp-82 (log aggregation)

**Decision**: Option A — DB storage + frontend UI. Simple, queryable, follows existing patterns.

---

## Database Schema

### Migration: `XXX_create_csp_violations.sql`

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

---

## API Design

### POST /api/csp-report (Modified)

**Request** (unchanged):
```json
{
  "csp-report": {
    "document-uri": "https://example.com/page",
    "referrer": "https://example.com/",
    "blocked-uri": "https://evil.com/script.js",
    "violated-directive": "script-src",
    "original-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'"
  }
}
```

**Response** (unchanged):
```
204 No Content
```

**New behavior**: Also INSERT into csp_violations table

### GET /api/v1/csp-violations

**Request**:
```
GET /api/v1/csp-violations?limit=20&offset=0&directive=script-src
```

**Response**:
```json
{
  "success": true,
  "data": {
    "violations": [
      {
        "id": 1,
        "violated_directive": "script-src",
        "blocked_uri": "https://evil.com/script.js",
        "document_uri": "https://example.com/page",
        "referrer": "https://example.com/",
        "created_at": "2025-07-12T12:00:00.000Z"
      }
    ],
    "total": 150,
    "limit": 20,
    "offset": 0
  }
}
```

### DELETE /api/v1/csp-violations

**Request**:
```
DELETE /api/v1/csp-violations
```

**Response**:
```json
{
  "success": true,
  "data": {
    "deletedCount": 150
  }
}
```

---

## Frontend Design

### CspViolations.vue

```vue
<template>
  <div class="csp-violations">
    <h2>CSP Violations</h2>
    
    <!-- Filter -->
    <div class="filters">
      <select v-model="filterDirective">
        <option value="">All Directives</option>
        <option value="script-src">script-src</option>
        <option value="style-src">style-src</option>
        <option value="img-src">img-src</option>
        <option value="connect-src">connect-src</option>
      </select>
      <button @click="loadViolations">Filter</button>
      <button @click="clearAll" class="danger">Clear All</button>
    </div>
    
    <!-- Table -->
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
          <td><code class="truncate">{{ v.blocked_uri }}</code></td>
          <td><code class="truncate">{{ v.document_uri }}</code></td>
        </tr>
      </tbody>
    </table>
    
    <p v-else class="empty">No violations found.</p>
    
    <!-- Pagination -->
    <div v-if="total > limit" class="pagination">
      <button @click="prevPage" :disabled="offset === 0">Previous</button>
      <span>Page {{ Math.floor(offset / limit) + 1 }}</span>
      <button @click="nextPage" :disabled="offset + limit >= total">Next</button>
    </div>
  </div>
</template>
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/cspViolations.test.js` | CRUD operations, pagination |
| API endpoint | Jest + supertest | `backend/src/__tests__/cspViolationsApi.test.js` | GET, DELETE, persistence |
| Frontend unit | Vitest | `frontend/src/__tests__/cspViolations.test.ts` | Table rendering, filtering |

---

## Risks and Edge Cases

### Backend Risks
- **[Table bloat]**: csp_violations table grows unbounded — Mitigation: Cleanup job deletes violations older than 30 days
- **[Large blocked_uri]**: blocked_uri could be very long — Mitigation: VARCHAR(1024) limit
- **[Concurrent inserts]**: Multiple CSP reports simultaneously — Mitigation: Simple INSERT, no complex logic

### Frontend Risks
- **[Empty state]**: No violations yet — Handle: Show "No violations found" message
- **[Large datasets]**: 1000+ violations — Handle: Pagination (20 per page)
- **[Long URIs]**: blocked_uri or document_uri exceeds display — Handle: CSS truncate with title tooltip

### Edge Cases
- **[blocked_uri is "inline"]**: Some browsers report "inline" for inline scripts — Handle: Display as-is
- **[blocked_uri is "(no-referrer)"]**: Handle: Display as-is
- **[original_policy is null]**: Handle: Display "N/A"

---

## Alternative Designs Considered

### Alternative 1: Log File Parsing
- **Pros**: No database changes
- **Cons**: Complex parsing, slower queries, log rotation issues
- **Decision**: DB storage is simpler and more reliable

### Alternative 2: External Storage (Elasticsearch)
- **Pros**: Powerful search/aggregation
- **Cons**: Adds new dependency, overkill for this use case
- **Decision**: DB storage for now, Elasticsearch in bp-82

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
