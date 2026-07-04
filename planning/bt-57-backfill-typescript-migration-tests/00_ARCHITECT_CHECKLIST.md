# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have read `04_SPECIFICATION.md` (if it exists) — I know the exact file operations, signatures, and test expectations
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input
- [ ] **Related ticket**: bp-57 (Migrate to TypeScript) is completed before starting this backfill

### Existing Infrastructure Audit

- [ ] I have checked if the **frontend API client** already exists
- [ ] I have checked if the **Pinia store** already exists
- [ ] I have checked if there are **existing test patterns** I should follow
- [ ] I have checked existing test files: `frontend/src/__tests__/`
- [ ] I have verified which test files need EXTENSION vs. which are entirely NEW

### Testing Strategy

- [ ] Unit test files identified per changed module
- [ ] Frontend Vitest tests: scenarios defined
- [ ] New test files CREATED for all new/changed code
- [ ] Regression test added for any bug fix
- [ ] Code coverage: no significant decrease in changed modules

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know which existing patterns to follow
- [ ] I know how to test (unit, integration, frontend, E2E)

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] Code coverage checked
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with completed status

## When to Ask the User

1. **Ambiguous acceptance criteria**
2. **Significant scope change**
3. **Conflicting requirements**
4. **Unknown unknowns**
5. **Production impact**
6. **UI placement decision**
7. **Backend API conflict**
8. **Model can't resolve**

Do NOT guess. Do NOT assume. Ask the user.

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
