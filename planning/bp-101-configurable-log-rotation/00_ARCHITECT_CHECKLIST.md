# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `backend/src/utils/logger.js` — DailyRotateFile transports are hardcoded
- [ ] I have verified `backend/src/utils/envValidation.js` — optional env vars pattern exists
- [ ] I have checked existing Docker volumes for `logs/` directory

### Testing Strategy

- [ ] Unit tests for env var defaults and overrides
- [ ] Tests verify logger still works with custom rotation settings
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All tests pass (`npm test`)
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] `npm run lint` passes
- [ ] Logger works with default env vars (7d, 100m)
- [ ] Logger works with custom env vars (e.g., LOG_ROTATION_DAYS=14, LOG_ROTATION_MAX_SIZE=50m)
- [ ] `docker compose up --build` starts without errors

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
