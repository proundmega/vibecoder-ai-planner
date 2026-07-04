# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have verified `jest.config.local.js` is not referenced by any npm script, CI config, or documentation
- [ ] I have verified `jest.config.local.js` content — what config does it contain?
- [ ] I have checked `jest.config.js` — confirmed `restoreMocks: false` at line 19
- [ ] I have checked if any test file relies on mocks not being restored (unlikely but verify)
- [ ] I have checked AGENTS.md for any mention of `jest.config.local.js`

### Testing Strategy

- [ ] Run `npm test` with `restoreMocks: true` — verify all tests still pass
- [ ] Run `npm test` without `jest.config.local.js` — verify no breakage
- [ ] Verify no CI step references `jest.config.local.js`

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know how to test

## Post-Implementation Checklist

- [ ] `jest.config.local.js` deleted
- [ ] `restoreMocks: true` in `jest.config.js`
- [ ] `npm test` passes
- [ ] `npm run test:integration` passes
- [ ] No test pollution observed in repeated test runs
