# 03_ARCHITECT_IMPLEMENTATION.md — Configurable Log Rotation Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Add env vars to envValidation.js

**MODIFY**: `backend/src/utils/envValidation.js`

Add to `optionalEnvVars`:
```javascript
LOG_ROTATION_DAYS: { type: 'int', default: 7 },
LOG_ROTATION_MAX_SIZE: { type: 'string', default: '100m' },
LOG_ROTATION_COMPRESS: { validValues: ['true', 'false'], default: 'true' },
```

### Phase 2: Read env vars in logger.js

**MODIFY**: `backend/src/utils/logger.js`

After the `logFormat` constant, add:
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

Replace hardcoded config in both DailyRotateFile transports with `rotateTransportConfig`.

### Phase 3: Tests

**MODIFY**: `backend/src/__tests__/logger.test.js`

Add tests:
- Logger works with default env vars (same behavior as before)
- Logger works with custom LOG_ROTATION_DAYS=14
- Logger works with LOG_ROTATION_COMPRESS=false

### Phase 4: Verify & Build

1. Run `cd backend && npm test` — verify tests pass
2. Run `cd backend && npm run test:coverage` — verify 60% coverage
3. Run `cd backend && npm run lint` — verify no lint errors

---

## Files Changed

```
backend/src/utils/envValidation.js  → MODIFY (add 3 env vars)
backend/src/utils/logger.js         → MODIFY (read env vars, use in transports)
backend/src/__tests__/logger.test.js → MODIFY (add env var override tests)
```

---

### i) Code Review Checklist

- [ ] Env vars added to `optionalEnvVars` with correct types and defaults
- [ ] Logger reads env vars and passes to DailyRotateFile transports
- [ ] Console transport unchanged
- [ ] Log format (JSON) unchanged
- [ ] All existing logger tests still pass
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
3. [ ] Backend: `npm run lint` passes
4. [ ] `logs/` directory created on first run
5. [ ] Rotated logs follow configured retention
6. [ ] `docker compose up --build` starts without errors

---

*Fill in all sections before starting implementation.*
