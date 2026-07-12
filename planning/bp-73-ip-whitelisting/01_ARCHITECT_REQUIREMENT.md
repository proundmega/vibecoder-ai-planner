# 01_ARCHITECT_REQUIREMENT.md — IP Whitelisting for Rate Limit Exceptions

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P2 (Security)
**Effort**: Small

---

## Requirement

Allow administrators to whitelist IP addresses that bypass rate limiting. This is useful for:
- CI/CD pipelines making automated API calls
- Internal monitoring tools
- Trusted partner integrations

Currently, all IPs are subject to the same rate limits with no exceptions.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Rate limiter middleware exists: `backend/src/middleware/rateLimiter.js`
- [x] Admin API endpoints exist: `backend/src/api/v1/index.js` — admin routes mounted
- [x] Admin permissions exist: `requireSuperAdmin` middleware

### Key Insight

The rate limiter middleware checks `req.ip` against a store. Adding IP whitelisting requires:
1. A database table to store whitelisted IPs
2. Admin API to manage the whitelist
3. Middleware modification to skip rate limit for whitelisted IPs

---

## Scope

### In Scope
- Create `ip_whitelist` table: `id`, `ip_address`, `description`, `created_by`, `created_at`
- Admin API: `GET /api/v1/admin/ip-whitelist` — list whitelisted IPs
- Admin API: `POST /api/v1/admin/ip-whitelist` — add IP to whitelist
- Admin API: `DELETE /api/v1/admin/ip-whitelist/:id` — remove IP from whitelist
- Rate limiter middleware: skip rate limit for whitelisted IPs
- Tests: unit tests for whitelist CRUD, integration test for rate limit bypass

### Out of Scope
- CIDR range support (single IPs only for now)
- IP whitelist expiration dates
- Email notification when IP is added/removed
- Audit log for whitelist changes
- Bulk import/export of whitelisted IPs

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 3 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |
| 4 | bp-02-db-pool-config | Connection pool metrics export to Prometheus/Grafana | Observability | bp-77-prometheus-metrics | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications |
| 2 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 3 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation |
| 4 | bp-02-db-pool-config | Connection pool metrics export to Prometheus/Grafana | Observability | bp-77-prometheus-metrics |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/` | NEW MIGRATION | Create `ip_whitelist` table |
| `backend/src/services/IpWhitelistService.js` | CREATE | CRUD operations for whitelist |
| `backend/src/controllers/adminController.js` | MODIFY | Add whitelist CRUD handlers |
| `backend/src/api/v1/index.js` | MODIFY | Mount whitelist routes |
| `backend/src/middleware/rateLimiter.js` | MODIFY | Skip rate limit for whitelisted IPs |
| `backend/src/__tests__/ipWhitelist.test.js` | CREATE | Unit tests |
| `backend/integration-test/suites/ip-whitelist.test.sh` | CREATE | Integration test |

---

## Acceptance Criteria

1. [ ] [Backend API] `ip_whitelist` table created via migration
2. [ ] [Backend API] `GET /api/v1/admin/ip-whitelist` returns list of whitelisted IPs
3. [ ] [Backend API] `POST /api/v1/admin/ip-whitelist` adds IP to whitelist
4. [ ] [Backend API] `DELETE /api/v1/admin/ip-whitelist/:id` removes IP from whitelist
5. [ ] [Backend API] All endpoints require SUPER_ADMIN role
6. [ ] [Middleware] Whitelisted IPs bypass rate limiting
7. [ ] [Tests] Unit tests for whitelist CRUD
8. [ ] [Integration Tests] Integration test for rate limit bypass
9. [ ] [Coverage] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- CIDR range support
- IP whitelist expiration dates
- Email notification when IP is added/removed
- Audit log for whitelist changes
- Bulk import/export of whitelisted IPs

---

## Security Considerations

- [ ] Only SUPER_ADMIN can manage whitelist
- [ ] IP addresses validated as valid IPv4 or IPv6
- [ ] Whitelist changes logged to audit log (deferred)

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/ipWhitelist.test.js`
- [ ] API endpoint tests: whitelist CRUD operations
- [ ] Integration tests: rate limit bypass for whitelisted IP
- [ ] **Bash integration suite**: test added in `backend/integration-test/suites/ip-whitelist.test.sh`
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
