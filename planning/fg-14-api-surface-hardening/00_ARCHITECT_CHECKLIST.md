# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: 2026-08-12
**Date completed**:
**Author**: AI Assistant
**Feature scope**: Backend
**Parent ticket**: fg-13 (FE↔BE API surface audit)

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [x] **Design decisions RESOLVED**: All choices follow existing Joi validation patterns; no new dependencies required

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — YES, all 18 mounted routers + inline routes inventoried
- [x] I have checked if there are **existing patterns** I should follow — YES, Joi schemas in `backend/src/validators/` (15 schemas already exist)
- [x] I have checked if there are **existing middleware** I should extend — YES, `validate` middleware (Joi-based) in `backend/src/middleware/validate.js`
- [x] I have checked if **shared components** exist that I should reuse — YES, `validate.js` middleware, Joi schema patterns
- [x] I have checked if the **feature should extend existing code** rather than creating new files — YES, extend `validate.js` middleware and add Joi schemas

### Dependency Analysis

- [ ] All new npm/system dependencies are listed with versions and purpose — NONE expected (Joi is already a dependency)
- [x] All existing services/modules that will be affected are identified — `middleware/validate.js`, `validators/` directory, all route files
- [ ] Breaking changes are noted (API contract changes, DB migration, config format) — NONE expected (validation is additive)
- [ ] No circular dependencies introduced

### Configuration Audit

- [ ] All new environment variables are documented with defaults — NONE expected
- [ ] All new config files or schema changes are documented — N/A
- [x] Backward compatibility maintained (old requests still work) — YES, validation is additive, not restrictive

### Database & Migration

- [x] If DB changes needed: migration file exists with both `up` and `rollback` SQL — NONE needed (validation is application layer only)

### Testing Strategy

- [x] Unit test files identified per changed module — `middleware/validate.test.js` extended, new Joi schema tests in `validators/`
- [ ] Backend Jest integration tests: scenarios defined for `jest.integration.config.js`
- [ ] **Bash integration suite**: test added in `backend/integration-test/suites/` — query param validation regression tests
- [x] Edge cases explicitly tested (not just happy path) — documented in 02
- [x] Contract tests: `frontend/src/__tests__/api-contract.test.ts` updated if response shapes changed — N/A (response shapes unchanged)
- [x] Response validation: `frontend/src/api/validator.ts` updated if response shapes changed — N/A
- [ ] **Test stubs created BEFORE production code** — stub files listed as first operations in 04_SPECIFICATION.md
- [ ] New test files CREATED for all new/changed code
- [ ] **Regression test added for every bug fix** — MANDATORY per bug-fix protocol
- [ ] **Coverage threshold (60%)**: run `npm run test:coverage` (backend) — CI enforces 60% min

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort — Medium
- [x] I know which files to create vs. modify — documented in 03
- [x] I know which existing patterns to follow (Joi schemas, validate middleware)
- [x] I know how to test (unit, integration)
- [x] I have identified the **branch** I will work on — `fix/fg-14-api-surface-hardening`

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test` in backend)
- [ ] Backend Jest integration tests pass (`npm run test:integration` if applicable)
- [ ] **Bash integration suite passes** (`cd backend && bash integration-test/run.sh --only`)
- [ ] Linting passes (`npm run lint` in backend)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — must pass 60% min on lines, functions, branches, statements
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with PR/branch info
- [ ] Code reviewed by another agent or human if available
- [ ] Post-deploy verification steps completed

## When to Ask the User

1. **Ambiguous acceptance criteria** — the requirement is unclear
2. **Significant scope change** — more work than estimated
3. **Conflicting requirements** — conflicts with existing feature
4. **Unknown unknowns** — something discovered that changes the approach
5. **Production impact** — could affect running users
6. **Backend API conflict** — creating something that conflicts with existing patterns

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
