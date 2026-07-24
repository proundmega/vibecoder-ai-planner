# 03_ARCHITECT_IMPLEMENTATION.md — Log Aggregation Pipeline Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Infrastructure
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Create Winston Transport

**CREATE**: `backend/src/utils/logTransport.js`

Implement `LogAggregationTransport` class extending `winston-transport`:
- Buffer logs (10 logs or 5s interval)
- Send batch via HTTPS POST
- Handle retries on failure
- Graceful degradation

### Phase 2: Add Env Vars

**MODIFY**: `backend/src/utils/envValidation.js`

Add to `optionalEnvVars`:
```javascript
LOG_AGGREGATION_URL: { type: 'string', default: '' },
LOG_AGGREGATION_API_KEY: { type: 'string', default: '' },
LOG_AGGREGATION_SOURCE: { type: 'string', default: 'vibecode-api' },
```

### Phase 3: Update Logger

**MODIFY**: `backend/src/utils/logger.js`

Add conditional aggregation transport:
```javascript
if (process.env.LOG_AGGREGATION_URL && process.env.LOG_AGGREGATION_API_KEY) {
  const LogAggregationTransport = require('./logTransport');
  transports.push(new LogAggregationTransport({
    url: process.env.LOG_AGGREGATION_URL,
    apiKey: process.env.LOG_AGGREGATION_API_KEY,
    source: process.env.LOG_AGGREGATION_SOURCE || 'vibecode-api',
  }));
}
```

### Phase 4: Update Docker Compose

**MODIFY**: `docker-compose.yml`

Add logging driver config for production:
```yaml
logging:
  driver: json-file
  options:
    max-size: "100m"
    max-file: "3"
```

### Phase 5: Tests

**CREATE**: `backend/src/__tests__/logTransport.test.js`

Add tests:
- Transport emits logs in JSON format
- Transport sends to aggregation URL
- Transport handles errors gracefully

### Phase 6: Verify & Build

1. Run `cd backend && npm test` — verify tests pass
2. Run `cd backend && npm run test:coverage` — verify 60% coverage
3. Run `cd backend && npm run lint` — verify no lint errors

---

## Files Changed

```
backend/src/utils/logTransport.js              → CREATE
backend/src/utils/envValidation.js             → MODIFY (add 3 env vars)
backend/src/utils/logger.js                    → MODIFY (add conditional transport)
docker-compose.yml                             → MODIFY (add logging driver)
backend/src/__tests__/logTransport.test.js     → CREATE
```

---

### i) Code Review Checklist

- [ ] `LogAggregationTransport` extends `winston-transport`
- [ ] Transport buffers logs (10 logs or 5s interval)
- [ ] Transport sends batch via HTTPS POST
- [ ] Transport handles retries on failure
- [ ] Logger conditionally adds transport when env vars are set
- [ ] Docker Compose logging driver configured
- [ ] All existing logger tests still pass
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] Logs emitted to stdout in JSON format
5. [ ] Logs forwarded to aggregation service when env vars set
6. [ ] `docker compose up --build` starts without errors

---

*Fill in all sections before starting implementation.*
