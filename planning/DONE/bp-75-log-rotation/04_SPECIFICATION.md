# 04_SPECIFICATION.md — Log File Rotation Execution Spec

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

### MODIFY: `backend/package.json`

**Add dependency** in the `dependencies` section:

```json
"winston-daily-rotate-file": "^5.0.0"
```

**Note**: Run `npm install` after modifying package.json.

---

### MODIFY: `backend/src/utils/logger.js`

**Replace the entire file** with the following contents. Read the existing file first to understand current structure, then replace:

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
      maxFiles: '7d',
      maxSize: '100m',
      zippedArchive: true
    })
  ],
  exitOnError: false
});

module.exports = logger;
```

**Key changes from existing file**:
- **Added**: `const DailyRotateFile = require('winston-daily-rotate-file');`
- **Removed**: `new transports.File({ filename: 'logs/app.log' })` (or similar)
- **Added**: `new DailyRotateFile({ dirname: 'logs', filename: 'app-%DATE%.log', datePattern: 'YYYY-MM-DD', zIndex: 1, maxFiles: '7d', maxSize: '100m', zippedArchive: true })`
- **Kept**: Console transport unchanged
- **Kept**: format (timestamp, json) unchanged
- **Kept**: defaultMeta unchanged

---

### MODIFY: `backend/src/__tests__/logger.test.js`

**Update existing tests** to work with new transport. Read the existing file first, then modify test assertions as needed. The tests should verify:

1. Logger writes to file transport
2. Logger writes in JSON format
3. Logger includes timestamp
4. Logger includes service name in defaultMeta

If existing tests fail after the change, update them to match the new transport behavior. The key requirement is that `logger.info()`, `logger.error()`, etc. still work and produce valid log entries.

---

## Test Expectations

List every test case the model must create, organized by layer. Do not write "test it works" — each case must describe a specific input, expected output, and why it matters.

### Backend Unit Tests — Logger
```
✓ [happy] logger.info() writes a log entry to file transport
✓ [happy] logger.error() writes an error log entry
✓ [shape] Log entry is valid JSON with timestamp, level, message fields
✓ [shape] Log entry includes defaultMeta.service = 'vibecode-api'
✓ [edge] logger with stack trace includes error stack in log
✓ [edge] Console transport still outputs to console
```

---

## Edge Cases to Handle

1. **[logs/ directory doesn't exist]**: winston-daily-rotate-file creates it automatically
2. **[First run]**: No existing log files — Handle: creates new `app-YYYY-MM-DD.log`
3. **[Multiple rotations in one day]**: File exceeds 100MB — Handle: appends numeric suffix (app-2025-07-12-1.log)
4. **[Docker volume]**: `logs/` must be in Docker volume mount — Handle: ensure docker-compose.yml includes `./logs:/app/logs`

---

## Existing Code Patterns to Follow

- Backend uses CommonJS (`require`, `module.exports`)
- Winston logger exports via `module.exports = logger`
- Log format is JSON (structured logging)
- Console transport uses `format.colorize()` and `format.simple()` for readability
- File transport uses `format.timestamp()` and `format.json()`

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-76-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | N/A | N/A | N/A | N/A | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `backend/src/index.js` — logger is imported, no changes needed
- `backend/src/middleware/` — middleware uses logger, no changes needed
- `backend/src/controllers/` — controllers use logger, no changes needed
- `backend/src/services/` — services use logger, no changes needed
- `frontend/` — no frontend changes needed

---

*This specification is the contract between planning and execution. If the model cannot produce code matching this spec, it should request human feedback rather than guessing.*
