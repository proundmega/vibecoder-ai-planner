# 04_SPECIFICATION.md — Configurable Log Rotation Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code.

---

## File Operations

### MODIFY: `backend/src/utils/envValidation.js`

**Add to `optionalEnvVars` object** (after existing entries, before the closing `}`):

```javascript
LOG_ROTATION_DAYS: { type: 'int', default: 7 },
LOG_ROTATION_MAX_SIZE: { type: 'string', default: '100m' },
LOG_ROTATION_COMPRESS: { validValues: ['true', 'false'], default: 'true' },
```

### MODIFY: `backend/src/utils/logger.js`

**After the `logFormat` constant definition** (line 28), add:

```javascript
const rotationDays = parseInt(process.env.LOG_ROTATION_DAYS || '7', 10);
const rotationMaxSize = process.env.LOG_ROTATION_MAX_SIZE || '100m';
const rotationCompress = process.env.LOG_ROTATION_COMPRESS !== 'false';

const rotateTransportConfig = {
  datePattern: 'YYYY-MM-DD',
  zIndex: 1,
  maxFiles: `${rotationDays}d`,
  maxSize: rotationMaxSize,
  zippedArchive: rotationCompress,
  format: logFormat,
};
```

**Replace the hardcoded config in both `DailyRotateFile` constructors** with `rotateTransportConfig`:

Before:
```javascript
new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxFiles: '7d',
  maxSize: '100m',
  zippedArchive: true,
  format: logFormat,
})
```

After:
```javascript
new DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  level: 'error',
  ...rotateTransportConfig,
})
```

Same pattern for the `combined` transport (remove `datePattern`, `maxFiles`, `maxSize`, `zippedArchive`, `format` from inline config — they come from `rotateTransportConfig`).

### MODIFY: `backend/src/__tests__/logger.test.js`

**Add a new describe block** after the existing "Winston Logger" describe:

```javascript
describe('Logger - Configurable Rotation', () => {
  it('uses default rotation settings when env vars are not set', () => {
    // Verify logger creates with default settings
    logger.info('test default rotation');
    expect(logger.info).toHaveBeenCalled();
  });

  it('respects LOG_ROTATION_DAYS env var', () => {
    // Set LOG_ROTATION_DAYS=14, verify logger works
    const original = process.env.LOG_ROTATION_DAYS;
    process.env.LOG_ROTATION_DAYS = '14';
    // Re-import or verify the config is read
    process.env.LOG_ROTATION_DAYS = original;
  });

  it('respects LOG_ROTATION_COMPRESS env var', () => {
    // Set LOG_ROTATION_COMPRESS=false, verify logger works
    const original = process.env.LOG_ROTATION_COMPRESS;
    process.env.LOG_ROTATION_COMPRESS = 'false';
    process.env.LOG_ROTATION_COMPRESS = original;
  });
});
```

---

## Test Expectations

### Backend Unit Tests — Logger
```
✓ [happy] logger.info() writes a log entry with default rotation settings
✓ [happy] logger with LOG_ROTATION_DAYS=14 uses 14-day retention
✓ [happy] logger with LOG_ROTATION_COMPRESS=false disables compression
✓ [shape] Log entry is valid JSON with timestamp, level, message fields
✓ [edge] Console transport still outputs to console regardless of rotation settings
```

---

## Edge Cases to Handle

1. **[LOG_ROTATION_DAYS=0]**: winston-daily-rotate-file will use `0d` which means no retention — acceptable behavior, user opted out
2. **[LOG_ROTATION_MAX_SIZE invalid format]**: winston-daily-rotate-file will reject at startup — user gets a clear error
3. **[LOG_ROTATION_COMPRESS='0']**: Treated as truthy (only `'false'` disables) — consistent with common env var patterns

---

## Existing Code Patterns to Follow

- Backend uses CommonJS (`require`, `module.exports`)
- Optional env vars follow the pattern in `envValidation.js`: `{ type: 'int', default: N }`
- Winston logger exports via `module.exports = logger`
- Log format is JSON (structured logging)

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `backend/src/index.js` — logger is imported, no changes needed
- `backend/src/middleware/` — middleware uses logger, no changes needed
- `frontend/` — no frontend changes needed
- `docker-compose.yml` — logs/ volume already mounted

---

*This specification is the contract between planning and execution.*
