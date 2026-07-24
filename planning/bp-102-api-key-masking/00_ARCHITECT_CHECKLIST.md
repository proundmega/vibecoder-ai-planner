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

- [ ] I have verified `backend/src/api/agents.js` — `GET /agents` returns raw DB rows including `api_key_hash`, `api_key_hash_prefix`
- [ ] I have verified `backend/src/api/agents.js` — `GET /agents/:agentId/key` already masks with `substring(0, 8) + '***'`
- [ ] I have verified `backend/src/utils/logger.js` — `maskSensitive()` exists and masks `apikey`, `token` fields
- [ ] I have checked credentials API for similar exposure patterns

### Testing Strategy

- [ ] Unit tests: verify list response masks api_key_hash and api_key_hash_prefix
- [ ] Unit tests: verify key preview endpoint still works
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Implementation Readiness

- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] All tests pass (`npm test`)
- [ ] `npm run test:coverage` passes (60% min threshold)
- [ ] `npm run lint` passes
- [ ] `GET /agents` returns masked keys (no raw hash values)
- [ ] `GET /agents/:agentId/key` still returns key preview
- [ ] No regression in other agent endpoints

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
