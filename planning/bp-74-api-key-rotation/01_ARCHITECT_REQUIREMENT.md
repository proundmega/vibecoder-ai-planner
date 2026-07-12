# 01_ARCHITECT_REQUIREMENT.md — API Key Rotation and Expiry

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1 (Security)
**Effort**: Medium

---

## Requirement

Implement API key rotation and expiry for agents. Currently, agent API keys (stored in `project_agents.api_key`) never expire and cannot be rotated without deleting and recreating the agent. This is a security risk — if a key is compromised, it remains valid indefinitely.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Agent model exists: `backend/src/models/` — agent table with `api_key` column
- [x] Agent controller exists: `backend/src/controllers/` — agent CRUD
- [x] Agent auth middleware exists: `backend/src/middleware/auth.js` — validates `X-API-Key` header
- [x] Mock keys: starts with `test-` or equals `mock-agent-key`

### Key Insight

The agent table has `api_key` (VARCHAR) but no expiry tracking. Adding rotation requires:
1. Add `api_key_expires_at` TIMESTAMP column
2. Add `api_key_rotated_at` TIMESTAMP column (last rotation)
3. Add `api_key_hash` column (store hashed key for comparison)
4. Admin API to rotate keys (generate new key, set expiry)
5. Middleware to reject expired keys
6. Optional: key history table to track rotated keys

---

## Scope

### In Scope
- Add `api_key_expires_at` TIMESTAMP to `project_agents` table
- Add `api_key_hash` VARCHAR to `project_agents` table (store bcrypt hash of key)
- Middleware: reject expired keys (return 401 with `KEY_EXPIRED` code)
- Admin API: `POST /api/v1/admin/agents/:id/rotate-key` — generate new key, set expiry (30 days default)
- On key rotation: hash new key, store in `api_key_hash`, set `api_key_expires_at`
- Tests: unit tests for key expiry, integration test for rotation

### Out of Scope
- Key history table (track all rotated keys)
- Email notification on key expiry
- Automatic key renewal
- Key rotation UI on frontend
- Configurable expiry duration (hardcoded to 30 days)

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation | ☐ |
| 4 | bp-02-db-pool-config | Connection pool metrics export to Prometheus/Grafana | Observability | bp-77-prometheus-metrics | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | bp-07-structured-logging | Log file rotation (winston-daily-rotate-file) | Observability | bp-75-log-rotation |
| 4 | bp-02-db-pool-config | Connection pool metrics export to Prometheus/Grafana | Observability | bp-77-prometheus-metrics |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/` | NEW MIGRATION | Add `api_key_expires_at`, `api_key_hash` to `project_agents` |
| `backend/src/middleware/auth.js` | MODIFY | Check key expiry, compare hashed keys |
| `backend/src/controllers/adminController.js` | MODIFY | Add rotate-key endpoint |
| `backend/src/services/AgentService.js` | MODIFY | Hash keys on creation/rotation |
| `backend/src/__tests__/apiKeyRotation.test.js` | CREATE | Unit tests |
| `backend/integration-test/suites/api-key-rotation.test.sh` | CREATE | Integration test |

---

## Acceptance Criteria

1. [ ] [Backend API] `project_agents` table has `api_key_expires_at` and `api_key_hash` columns
2. [ ] [Backend API] New agents get hashed keys with 30-day expiry
3. [ ] [Backend API] Expired keys return 401 with `KEY_EXPIRED` code
4. [ ] [Backend API] `POST /api/v1/admin/agents/:id/rotate-key` generates new key
5. [ ] [Backend API] Key rotation sets new `api_key_expires_at` (30 days from now)
6. [ ] [Backend API] Old key is invalidated after rotation
7. [ ] [Middleware] Auth middleware uses `api_key_hash` for comparison
8. [ ] [Tests] Unit tests for key expiry and rotation
9. [ ] [Integration Tests] Integration test for key rotation flow
10. [ ] [Coverage] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Key history table
- Email notification on key expiry
- Automatic key renewal
- Key rotation UI on frontend
- Configurable expiry duration

---

## Security Considerations

- [ ] API keys stored as bcrypt hashes (not plaintext)
- [ ] Expired keys cannot be used
- [ ] Key rotation invalidates old key immediately
- [ ] Hash comparison timing-attack safe (bcrypt handles this)

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/apiKeyRotation.test.js`
- [ ] API endpoint tests: key rotation, expiry check
- [ ] Integration tests: full rotation flow
- [ ] **Bash integration suite**: test added in `backend/integration-test/suites/api-key-rotation.test.sh`
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
