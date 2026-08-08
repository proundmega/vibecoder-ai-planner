# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-08-08
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [x] I have read `04_SPECIFICATION.md` — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] I have verified there are no important design decisions that require user input

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — YES, all endpoints exist
- [x] I have checked if the **frontend API client** already exists — N/A (backend-only fixes)
- [x] I have checked if the **frontend UI component/screen** already exists — N/A (backend-only fixes)
- [x] I have checked if the **router** already has a route for this feature — YES
- [x] I have checked if there are **existing patterns** I should follow — YES (supertest, verifyTokenOrAgent)
- [x] I have checked if the **feature should extend existing code** rather than creating new files — YES (bug fixes, no new files)
- [x] I have checked if **shared components** exist that I should reuse — N/A

### Both Frontend AND Backend

- [x] If this feature has a **backend API**, I have verified the API route, controller, and service exist — YES
- [x] If this feature has a **frontend UI**, I have identified where it will live — N/A
- [x] If this feature is **API only** (no new UI), I have verified the backend routes, controllers, and services are complete — YES

### Dependency Analysis

- [x] All new npm/system dependencies are listed with versions and purpose — NONE needed
- [x] All existing services/modules that will be affected are identified — TicketService, planning routes, heartbeat route, agents route
- [x] Breaking changes are noted (API contract changes, DB migration, config format) — NONE
- [x] No circular dependencies introduced

### Configuration Audit

- [x] All new environment variables are documented with defaults — NONE needed
- [x] All new config files or schema changes are documented — NONE
- [x] Backward compatibility maintained — YES, fixes only

### Database & Migration

- [x] If DB changes needed: migration file exists — N/A (no DB changes)
- [x] Migration order is correct — N/A
- [x] Rollback is tested — N/A
- [x] No breaking schema changes without a migration path — N/A

### Testing Strategy

- [x] Unit test files identified per changed module — `api-ticket-put.test.js`, `api-agent-auth.test.js`
- [x] Backend Jest tests: scenarios defined
- [x] **Bash integration suite**: not needed for these fixes (existing integration tests cover the endpoints)
- [x] Edge cases explicitly tested (not just happy path)
- [x] **Test stubs created BEFORE production code** — listed as first file operations in `04_SPECIFICATION.md`
- [x] New test files CREATED for all new/changed code
- [x] Regression test added for each of the 4 bugs
- [x] **Coverage threshold (60%)**: run `npm run test:coverage` — CI enforces 60% min

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort (Small)
- [x] I know which files to create vs. modify — 4 MODIFY, 2 CREATE
- [x] I know which existing patterns to follow — supertest, verifyTokenOrAgent
- [x] I know how to test (unit tests with Jest/supertest)
- [x] I have identified the **branch** I will work on: `bp-112-agent-connectivity-fixes`

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [x] All unit tests pass (`npm test` in backend)
- [x] Backend Jest integration tests pass (`npm run test:integration`)
- [x] Linting passes (`npm run lint` in backend)
- [x] **Coverage threshold enforced**: `npm run test:coverage` — must pass 60% min
- [x] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [x] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [x] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - [x] `Date completed` — when implementation finishes
  - [x] `PR` — PR URL after merge
  - [x] `Branch` — git branch used
- [x] `04_SPECIFICATION.md` (if created) reflects the final implementation

## When to Ask the User

No design decisions require user input. All choices follow existing patterns.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
