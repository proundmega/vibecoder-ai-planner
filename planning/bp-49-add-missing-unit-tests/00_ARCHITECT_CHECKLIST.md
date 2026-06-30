# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: 2026-06-30
**Date completed**:
**Author**: AI Assistant
**Feature scope**: Backend (Testing)

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below.

### Planning
- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design and testing strategy
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps

### Existing Infrastructure Audit
- [x] Six services are verified to have zero unit test coverage
- [x] Existing test patterns identified: `src/__tests__/jest.setup.js`, supertest usage, moduleNameMapper
- [x] Existing mocks cover pg, winston, bcryptjs, uuid, jsonwebtoken — additional mocks needed for dockerode, ssh2

### Testing Strategy
- [x] Each service gets a dedicated test file in `backend/src/__tests__/`
- [x] Tests mock external dependencies (dockerode, ssh2) via jest.mock
- [x] Tests cover success path, validation errors, auth errors, edge cases
- [x] New tests verified: `cd backend && npm test`

### Implementation Readiness
- [x] 6 new test files to create, zero existing files to modify
- [x] Follow existing test patterns (supertest, jest.mock, etc.)
- [x] Implementation order: external deps first (dockerode: PoolManager, TerminalProxy, ProvisioningService), then pure services (MilestoneService, DeployService, ReviewService)
