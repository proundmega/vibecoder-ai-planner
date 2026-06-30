# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: 2026-06-30
**Date completed**:
**Author**: AI Assistant
**Feature scope**: Backend (Testing)

---

## Pre-Implementation Checklist

### Planning
- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — requirement, scope, acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — design, testing strategy, mocking approach
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — actions, per-file plans, verification

### Existing Infrastructure Audit
- [x] TemplateService: 630 lines, controller test mocks it fully — zero exercised coverage
- [x] ProviderService: 95 lines, rules engine — zero coverage
- [x] AgentService: 121 lines, rate limiting + complex queries — zero coverage
- [x] PG mock exists globally via jest.setup.js
- [x] crypto mock needed for ProviderService (decrypt)
- [x] No Docker/ssh2 dependencies to mock for these 3 services

### Testing Strategy
- [x] 3 new test files in `backend/src/__tests__/`
- [x] TemplateService: content generators (pure function tests) + DB operation tests
- [x] ProviderService: rule matching engine edge cases, API key resolution
- [x] AgentService: rate limit calculation, query correctness
- [x] Existing templateController.test.js still passes (it mocks TemplateService, unaffected)

### Implementation Readiness
- [x] Implementation order: ProviderService → AgentService → TemplateService (easiest → hardest)
- [x] Follow existing test patterns: jest.mock, supertest for controller-level, direct imports for service-level
