# bp-49: Add Missing Unit Tests for Untested Features

**Status**: planned
**Date created**: 2026-06-30
**Scope**: Testing / Backend
**Priority**: P2
**Effort**: Large

## Requirement

Six recently-merged features lack backend unit tests. Each has a dedicated service and API route file with zero test coverage. Add Jest unit tests following the established patterns in `backend/src/__tests__/`.

## Existing Infrastructure Audit

For each feature, the backend service + route exist but no unit test file references them.

### Feature 1: ProvisioningService (bp-40 — Compute Nodes)
- Service: `backend/src/services/ProvisioningService.js`
- Route: `backend/src/api/compute-nodes.js`
- Validator: `backend/src/validators/computeNodes.js`
- No test coverage in `backend/src/__tests__/`

### Feature 2: MilestoneService (bp-39 — Milestones)
- Service: `backend/src/services/MilestoneService.js`
- Route: `backend/src/api/milestones.js`
- Validator: `backend/src/validators/milestones.js`
- No test coverage in `backend/src/__tests__/`

### Feature 3: DeployService (bp-37 — Deployment Pipeline)
- Service: `backend/src/services/DeployService.js`
- Route: `backend/src/api/deployments.js`
- Validator: `backend/src/validators/deployments.js`
- No test coverage in `backend/src/__tests__/`

### Feature 4: PoolManager (bp-36 — Auto-Manage Agent Containers)
- Service: `backend/src/services/PoolManager.js`
- Route: `backend/src/api/pool.js`
- Validator: `backend/src/validators/pool.js`
- No test coverage in `backend/src/__tests__/`

### Feature 5: TerminalProxy (bp-38 — Web Terminal)
- Service: `backend/src/services/TerminalProxy.js`
- Route: `backend/src/api/terminal.js`
- No test coverage in `backend/src/__tests__/`

### Feature 6: ReviewService (bp-35 — Local Diff Storage)
- Service: `backend/src/services/ReviewService.js`
- Route: `backend/src/api/review.js`
- No test coverage in `backend/src/__tests__/`

## Acceptance Criteria

- [ ] Each of the 6 services has a dedicated unit test file at `backend/src/__tests__/<serviceName>.test.js`
- [ ] Each test file mocks pg, external dependencies (dockerode, ssh2, etc.) via jest.mock
- [ ] Tests cover: success path, validation errors, auth errors, edge cases
- [ ] All new tests pass: `cd backend && npm test`
- [ ] Existing tests still pass after adding new tests

## Out of Scope

- Integration tests (these require real DB / Docker daemon)
- Frontend test coverage for the associated UI components
- Refactoring the services themselves

## Known Unknowns

- Whether `PoolManager` and `TerminalProxy` require Docker daemon mocking for realistic tests (dockerode is already mocked in jest.setup.js)
- Whether `ReviewService` has git-level dependencies that need special mocking
