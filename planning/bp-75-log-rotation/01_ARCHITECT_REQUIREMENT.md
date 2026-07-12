# 01_ARCHITECT_REQUIREMENT.md — Log File Rotation with Winston Daily Rotate

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P3 (Infrastructure)
**Effort**: Small

---

## Requirement

Implement log file rotation to prevent disk space exhaustion from unbounded log growth. Currently, Winston logs to a single file (`logs/app.log`) with no rotation. In production, this can fill up disk space over time.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Logger exists: `backend/src/utils/logger.js` — Winston logger configured
- [x] Log file: `logs/app.log` — single file, no rotation
- [x] Log format: JSON (structured logging)

### Key Insight

Winston has a built-in `winston-daily-rotate-file` transport that handles rotation automatically. Adding it requires:
1. Install `winston-daily-rotate-file` dependency
2. Configure transport with rotation rules (size, date pattern, max files)
3. Keep console transport for local development

---

## Scope

### In Scope
- Install `winston-daily-rotate-file` npm package
- Configure daily rotation: `logs/app-%DATE%.log`
- Rotate daily at midnight
- Keep 7 days of logs (delete older)
- Max 100MB per file (rotate if exceeded)
- Compress rotated logs (gzip)
- Tests: verify logger still works, no breaking changes

### Out of Scope
- Log aggregation pipeline (Datadog, CloudWatch, etc.)
- Distributed tracing integration
- Log-based alerting rules
- Log retention configuration via env vars (hardcoded for now)
- Remote log shipping

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-02-db-pool-config | Connection pool metrics export to Prometheus/Grafana | Observability | bp-77-prometheus-metrics | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-02-db-pool-config | Connection pool metrics export to Prometheus/Grafana | Observability | bp-77-prometheus-metrics |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/package.json` | MODIFY | Add `winston-daily-rotate-file` dependency |
| `backend/src/utils/logger.js` | MODIFY | Configure daily rotate transport |
| `backend/src/__tests__/logger.test.js` | MODIFY | Update logger tests if needed |

---

## Acceptance Criteria

1. [ ] [Backend] `winston-daily-rotate-file` installed
2. [ ] [Backend] Logs rotate daily to `logs/app-%DATE%.log`
3. [ ] [Backend] Rotated logs are compressed (gzip)
4. [ ] [Backend] Older than 7 days logs are deleted
5. [ ] [Backend] Files over 100MB are rotated immediately
6. [ ] [Backend] Console transport still works for local development
7. [ ] [Tests] Existing logger tests still pass
8. [ ] [Coverage] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Log aggregation pipeline
- Distributed tracing integration
- Log-based alerting rules
- Log retention configuration via env vars
- Remote log shipping

---

## Performance Considerations

- Expected load: ~1000 log lines/hour in production
- Compression adds ~5% CPU overhead during rotation
- File I/O is async, no blocking

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: verify logger still works after changes
- [ ] No new tests needed (existing logger tests cover basic functionality)
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
