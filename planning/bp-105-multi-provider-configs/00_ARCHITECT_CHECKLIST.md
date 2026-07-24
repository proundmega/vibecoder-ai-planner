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

- [ ] I have verified `backend/src/services/ProviderService.js` — single global provider with routing rules
- [ ] I have verified `backend/src/api/providers.js` — CRUD for providers, `/resolve` endpoint
- [ ] I have checked `providers` table schema for `is_project_director` and `routing_rules` columns

### Testing Strategy

- [ ] Unit tests: verify multi-provider resolution logic
- [ ] Unit tests: verify project-scoped providers override global
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All tests pass (`npm test`)
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] `npm run lint` passes
- [ ] Provider resolution works with multiple named configs
- [ ] Project-scoped providers override global provider
- [ ] No regression in existing single-provider flow

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
