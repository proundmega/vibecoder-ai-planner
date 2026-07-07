# 00_ARCHITECT_CHECKLIST.md — Fix Bash Integration Test Suite (Round 2)

**Status**: in_progress
**Date started**: 2026-07-06
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend | Tests

---

## Pre-Implementation Checklist

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement: fix remaining 74 failing bash integration tests
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design: fix helper functions, test assertions, and endpoint URLs
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions: fix register/login assertions, fix assert_field to handle .data, fix test URLs
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] No design decisions require user input. All choices follow existing patterns.

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists — YES, all endpoints exist
- [x] I have checked if the **test infrastructure** already exists — YES, `backend/integration-test/` with 27 suite files
- [x] I have checked if there are **existing patterns** I should follow — YES, `helpers.sh` has assert functions, suites use `register`/`login` helpers
- [x] I have verified there are no important design decisions that require user input

### Dependency Analysis

- [x] No new npm dependencies needed
- [x] Affected files: `helpers.sh`, all test suites
- [x] No breaking changes to API contracts
- [x] No circular dependencies introduced

### Testing Strategy

- [x] Bash integration suite tests will be re-run after fixes: `bash backend/integration-test/run.sh --only`
- [x] Edge cases explicitly tested (response format edge cases, auth edge cases)
- [x] Regression test: all 74 previously failing tests must pass after fixes
- [x] Code coverage: no significant decrease in changed modules

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort
- [x] I know which files to create vs. modify
- [x] I know which existing patterns to follow (naming, structure, error handling)
- [x] I know how to test (bash integration suite re-run)
- [x] I have identified the **branch** I will work on: `fix/bp-68-integration-test-fixes`

## Post-Implementation Checklist

- [x] Bash integration suite passes (`bash backend/integration-test/run.sh --only`)
- [x] All 109 tests pass (35 existing passes + 74 previously failing)
- [x] Backend Jest tests still pass (`npm test`)
- [x] Linting passes (`npm run lint` in backend)
- [x] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed` — when implementation finishes
  - `PR` — PR URL after merge
  - `Branch` — git branch used
- [x] No new lint errors introduced

## When to Ask the User

No design decisions require user input. All fixes follow existing patterns in the codebase.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
