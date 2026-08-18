# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2025-08-18
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend + Java Agent

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
- [x] I have checked if the **frontend API client** already exists — YES, `frontend/src/api/agents.ts`
- [x] I have checked if the **frontend UI component/screen** already exists — YES, `AgentList.vue`
- [x] I have checked if the **router** already has a route — YES
- [x] I have checked if there are **existing patterns** to follow — YES, following existing test patterns
- [x] I have checked if the **feature should extend existing code** — YES, extending existing services

### Both Frontend AND Backend

- [x] Backend API exists — YES, all three endpoints already exist
- [x] Frontend UI exists — YES, AgentList.vue
- [x] Frontend API client covers needed endpoints — YES
- [x] No new API endpoints needed
- [x] No new frontend UI needed

### Dependency Analysis

- [x] No new npm/system dependencies
- [x] All affected services identified: `AgentService`, `HeartbeatService`, `AgentApp`
- [x] No breaking changes to API contracts (fixing broken contracts)
- [x] No circular dependencies introduced

### Configuration Audit

- [x] No new environment variables
- [x] No new config files
- [x] Backward compatibility maintained (Java agent defensive parsing)

### Database & Migration

- [x] No DB changes needed — no migration file required

### Testing Strategy

- [x] Unit test files identified per changed module
- [x] New regression test file: `agentProviderConfig.test.js`
- [x] Edge cases explicitly tested
- [x] Test stubs created BEFORE production code (listed in 04_SPECIFICATION.md)
- [x] New test files CREATED for all new/changed code
- [x] Regression test added for double-wrapping bug
- [x] Regression test added for agents-visible-in-heartbeat bug
- [x] Coverage threshold (60%): `npm run test:coverage`

---

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test` in backend)
- [ ] Linting passes (`npm run lint` in backend)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — must pass 60% min
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed` — when implementation finishes
  - `PR` — PR URL after merge
  - `Branch` — git branch used
- [ ] `04_SPECIFICATION.md` reflects the final implementation

---

## When to Ask the User

No design decisions require user input. All choices follow existing patterns.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
