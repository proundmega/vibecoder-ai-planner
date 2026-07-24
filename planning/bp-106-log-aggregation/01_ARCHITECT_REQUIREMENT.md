# 01_ARCHITECT_REQUIREMENT.md — Log Aggregation Pipeline

**Status**: planned
**Date created**: 2025-07-24
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend + Infrastructure
**Priority**: P3 (Observability)
**Effort**: Medium

---

## Requirement

Logs are written to files via Winston DailyRotateFile but not forwarded to a central log aggregation service (Datadog, CloudWatch, etc.). Operators need structured logs flowing to an external service for centralized querying, alerting, and dashboards.

---

## Existing Infrastructure Audit

### Backend Logs Check
- [x] Logger: `backend/src/utils/logger.js` — Winston with Console + DailyRotateFile transports
- [x] Log format: JSON structured logging (`winston.format.json()`)
- [x] Docker Compose: `docker-compose.yml` — uses default logging driver
- [x] Optional env vars: `LOG_LEVEL` already configurable

### Key Insight

Winston supports custom transports. The `winston-transport` package provides a base class for building custom transports. We can create a transport that:
1. Emits logs to stdout (for Docker to capture)
2. Optionally forwards to Datadog/CloudWatch via HTTP API

---

## Scope

### In Scope
- Create `backend/src/utils/logTransport.js` — base Winston transport class
- Add env vars: `LOG_AGGREGATION_URL`, `LOG_AGGREGATION_API_KEY`, `LOG_AGGREGATION_SOURCE`
- Update `logger.js` to conditionally add aggregation transport
- Docker Compose: add logging driver config for production
- Tests: verify transport configuration

### Out of Scope
- Log-based alerting rules (separate ticket)
- Distributed tracing integration (separate ticket)
- Log retention/purging policies
- Log analytics dashboards
- Cost monitoring for log ingestion

---

## Pending Scope Items to Present to User

All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/utils/logTransport.js` | CREATE | Winston transport base class |
| `backend/src/utils/logger.js` | MODIFY | Add conditional aggregation transport |
| `backend/src/utils/envValidation.js` | MODIFY | Add aggregation env vars |
| `docker-compose.yml` | MODIFY | Add logging driver config |
| `backend/src/__tests__/logTransport.test.js` | CREATE | Unit tests for transport |

---

## Acceptance Criteria

1. [ ] Winston transport emits logs to stdout in JSON format
2. [ ] Transport is conditionally enabled via `LOG_AGGREGATION_URL`
3. [ ] API key sent in `DD-API-KEY` header (Datadog) or `Authorization` header (CloudWatch)
4. [ ] Source/service tag set via `LOG_AGGREGATION_SOURCE`
5. [ ] Docker Compose logging driver configured for production
6. [ ] All existing logger tests still pass
7. [ ] `npm run test:coverage` passes (60% min threshold)

---

## Out of Scope

- Log-based alerting rules
- Distributed tracing integration
- Log retention/purging policies
- Log analytics dashboards
- Cost monitoring for log ingestion

---

## Performance Considerations

- Transport buffers logs and sends in batches (10 logs or 5s interval)
- HTTP requests are async — don't block log emission
- Graceful degradation: if aggregation service is down, logs still go to Console + files

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: verify transport emits logs in JSON format
- [ ] Unit tests: verify transport sends to aggregation URL
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

---

*Fill in all sections before starting implementation.*
