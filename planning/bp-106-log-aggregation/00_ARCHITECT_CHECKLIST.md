# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend + Infrastructure

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `backend/src/utils/logger.js` — Winston logger with DailyRotateFile
- [ ] I have checked Docker Compose for logging driver configuration
- [ ] I have verified existing log format (JSON structured logging)

### Testing Strategy

- [ ] Unit tests: verify Winston transport configuration
- [ ] Integration tests: verify logs are emitted to stdout in correct format
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All tests pass (`npm test`)
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] `npm run lint` passes
- [ ] Docker Compose logging driver configured for Datadog/CloudWatch
- [ ] Logs emitted in JSON format (already the case)
- [ ] No regression in local logging (Console transport)

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
