# 01_ARCHITECT_REQUIREMENT.md — CSP Violation Reporting Dashboard

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Priority**: P2 (Security)
**Effort**: Small

---

## Requirement

CSP violation reports are received by the backend but only logged to file. There's no way to view, search, or analyze CSP violations in the frontend. This creates a blind spot — violations happen but nobody sees them.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] CSP report endpoint exists: `backend/src/api/csp-report.js` — accepts violation reports
- [x] CSP headers set: helmet middleware configured
- [x] Violations logged to file: `logger.warn('CSP Violation Report:', ...)`
- [x] No database storage for violations — **GAP**
- [x] No frontend UI to view violations — **GAP**

### Key Insight

CSP violations are currently logged to Winston but not persisted. To enable analysis, we need:
1. Store violations in database (csp_violations table)
2. Backend API to list/search violations
3. Frontend UI to view violations (Security settings page or new page)

---

## Scope

### In Scope
- Create `csp_violations` table: `id`, `violated_directive`, `blocked_uri`, `document_uri`, `referrer`, `original_policy`, `created_at`
- Modify CSP report endpoint to persist violations to DB
- Backend API: `GET /api/v1/csp-violations` — list violations (paginated)
- Backend API: `GET /api/v1/csp-violations/:id` — get single violation
- Backend API: `DELETE /api/v1/csp-violations` — clear all violations
- Frontend: CSP Violations page in Settings (or new Security section)
- Frontend: Table showing violations with date, directive, blocked URI
- Frontend: Filter by directive type
- Tests: unit tests for backend API, Vitest tests for frontend

### Out of Scope
- Auto-remediation of CSP violations
- Email notification on violations
- CSP policy generation/management UI
- Blocklist of violating URIs
- CSP header configuration (static in helmet)

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
| `backend/src/migrations/` | NEW MIGRATION | Create `csp_violations` table |
| `backend/src/api/csp-report.js` | MODIFY | Persist violations to DB |
| `backend/src/api/csp-violations.js` | CREATE | New router for violation CRUD |
| `backend/src/api/v1/index.js` | MODIFY | Mount csp-violations router |
| `frontend/src/views/CspViolations.vue` | CREATE | New view for violations |
| `frontend/src/router/index.ts` | MODIFY | Add route for violations |
| `frontend/src/api/cspViolations.js` | CREATE | New API client |
| `frontend/src/__tests__/cspViolations.test.ts` | CREATE | Frontend tests |

---

## Known Unknowns

1. **Should violations be project-scoped or global?** — Assumed global (CSP is server-level, not per-project).
2. **Should there be a cleanup job for old violations?** — Assumed YES, delete violations older than 30 days.
3. **Where in the UI should violations be displayed?** — Assumed in Settings page under "Security" section.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **Violation retention period?** — 30 days (default) — or configurable? — {{30 days / configurable}}
2. **UI location for violations?** — Settings > Security — or separate page? — {{Settings > Security / separate page}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend API] `csp_violations` table created via migration
2. [ ] [Backend API] CSP report endpoint persists violations to DB
3. [ ] [Backend API] `GET /api/v1/csp-violations` returns paginated list
4. [ ] [Backend API] `DELETE /api/v1/csp-violations` clears all violations
5. [ ] [Backend API] Violations older than 30 days are auto-deleted (cleanup job)
6. [ ] [Frontend UI] CSP Violations page exists in Settings
7. [ ] [Frontend UI] Table shows violations with date, directive, blocked URI
8. [ ] [Frontend UI] Filter by directive type works
9. [ ] [Frontend Tests] Unit tests for API client
10. [ ] [Coverage] `npm run test:coverage` (backend) and `npm test -- --run --coverage` (frontend) pass (60% min)

---

## Out of Scope

- Auto-remediation of CSP violations
- Email notification on violations
- CSP policy generation/management UI
- Blocklist of violating URIs
- CSP header configuration

---

## Security Considerations

- [ ] Only authenticated users can view violations
- [ ] No PII exposed in violation reports (blocked_uri may contain user data)
- [ ] Violations are read-only (cannot be modified, only deleted)

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/cspViolations.test.js` — test CRUD operations
- [ ] API endpoint tests: test GET, DELETE endpoints
- [ ] Integration tests: test CSP report persistence
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/cspViolations.test.ts` — test violations page
- [ ] Component tests: test table rendering, filtering
- [ ] Loading, error, and empty states tested

---

*Fill in all sections before starting implementation.*
