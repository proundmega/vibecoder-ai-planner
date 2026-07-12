# 03_ARCHITECT_IMPLEMENTATION.md — Log File Rotation Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Install Dependency

```bash
cd backend && npm install winston-daily-rotate-file
```

---

### Phase 2: Configure Winston Daily Rotate Transport

#### `backend/src/utils/logger.js` (MODIFY)

**Replace file transport with daily rotate transport**:

```javascript
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'vibecode-api' },
  transports: [
    // Console transport (local development)
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    // Daily rotate transport (production)
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zIndex: 1,
      maxFiles: '7d',     // Keep 7 days of logs
      maxSize: '100m',    // Rotate if file exceeds 100MB
      zippedArchive: true // Compress rotated logs
    })
  ],
  exitOnError: false
});

module.exports = logger;
```

**Changes from existing logger**:
- **Removed**: `new transports.File({ filename: 'logs/app.log' })`
- **Added**: `new DailyRotateFile({ ... })` with rotation config
- **Kept**: Console transport unchanged for local development

---

### Phase 3: Tests

#### MODIFY: `backend/src/__tests__/logger.test.js`

**Update existing tests** to work with new transport:

```javascript
const logger = require('../utils/logger');

describe('Logger', () => {
  it('logs info messages', () => {
    // Spy on console.log or file write
    logger.info('test message');
    // Assert log was written
  });

  it('logs in JSON format to file', () => {
    // Log a message
    // Assert log line contains expected JSON fields
  });

  it('includes timestamp in log entries', () => {
    // Log a message
    // Assert timestamp field present
  });

  it('includes service name in defaultMeta', () => {
    // Log a message
    // Assert defaultMeta.service === 'vibecode-api'
  });
});
```

---

### Phase 4: Verify & Build

1. Run `cd backend && npm test` — verify tests pass
2. Run `cd backend && npm run test:coverage` — verify 60% coverage
3. Run `cd backend && npm run lint` — verify no lint errors
4. Run `cd backend && npm run generate:spec` — spec unchanged (no API changes)
5. Manual: Start server, verify `logs/app-YYYY-MM-DD.log` files are created

---

## Files Changed

```
backend/package.json                                                    → MODIFY (add winston-daily-rotate-file)
backend/src/utils/logger.js                                             → MODIFY (replace File with DailyRotateFile)
backend/src/__tests__/logger.test.js                                    → MODIFY (update if needed)
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
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | N/A | N/A | N/A | N/A | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] `winston-daily-rotate-file` added to package.json dependencies
- [ ] DailyRotateFile transport configured with correct options
- [ ] Console transport preserved for local development
- [ ] Log format (JSON) preserved
- [ ] `logs/` directory created if not exists (winston creates it automatically)
- [ ] Docker volume mount includes `logs/` directory
- [ ] All existing logger tests still pass
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] `logs/` directory created on first run
5. [ ] `logs/app-YYYY-MM-DD.log` files created (one per day)
6. [ ] Rotated files are compressed (.gz)
7. [ ] Logs older than 7 days are deleted
8. [ ] Files over 100MB are rotated immediately
9. [ ] Console output still works for local development
10. [ ] `docker compose up --build` starts without errors
11. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
