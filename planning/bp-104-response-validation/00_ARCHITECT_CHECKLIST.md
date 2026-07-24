# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend + Backend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `frontend/src/api/client.ts` — `extractData()` accepts optional validator
- [ ] I have verified `frontend/src/api/validator.ts` — `validateApiResponseStrict()` exists
- [ ] I have verified `frontend/src/api/validator.ts` — `validateSchema()` factory exists
- [ ] I have checked which stores/components use the API client

### Testing Strategy

- [ ] Unit tests: verify response validation catches shape mismatches
- [ ] Unit tests: verify validation is opt-in (doesn't break existing calls)
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All tests pass
- [ ] Frontend builds without errors (`npm run build`)
- [ ] `npm run typecheck` passes
- [ ] Response validation catches shape mismatches in dev
- [ ] No regression in existing API calls

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
