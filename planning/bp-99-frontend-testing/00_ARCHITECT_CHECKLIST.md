# 00_ARCHITECT_CHECKLIST.md — Frontend Testing Strategy

**Status**: pending
**Date started**: 2026-07-17
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend tests + refactoring

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [ ] I have checked if the **backend API** already exists — N/A (tests only)
- [ ] I have checked if the **frontend API client** already exists — Yes, all 5 API clients exist
- [ ] I have checked if the **frontend UI component/screen** already exists — Yes, `ProjectDetail.vue` exists, will refactor
- [ ] I have checked if the **router** already has a route for this feature — N/A (no route changes)
- [ ] I have checked if there are **existing patterns** I should follow — `src/__tests__/client.test.js`, `src/__tests__/auth-store.test.js`
- [ ] I have checked if the **feature should extend existing code** rather than creating new files — Extend `ProjectDetail.vue`, create new composables and test files

### Both Frontend AND Backend

- [ ] I have verified the **API route, controller, and service exist or will be created** — N/A (frontend-only)
- [ ] I have verified the **frontend API client can call existing backend endpoints** — Yes, all 5 API clients already exist
- [ ] I have checked the **OpenAPI spec** — N/A (no API changes)
- [ ] I have checked if **generated TypeScript types** need regeneration — N/A (no API changes)

### Dependency Analysis

- [ ] All new npm/system dependencies are listed with versions and purpose — **None** (all existing deps)
- [ ] All existing services/modules that will be affected are identified — `ProjectDetail.vue`, `diff.ts`
- [ ] Breaking changes are noted — **None** (refactoring only, same behavior)
- [ ] No circular dependencies introduced — N/A

### Configuration Audit

- [ ] All new environment variables are documented with defaults — **None** (no env var changes)
- [ ] All new config files or schema changes are documented — **None**

### Database & Migration

- [ ] No DB changes needed — **None** (frontend-only)

### Testing Strategy

- [ ] Unit test files identified per changed module — See 04_SPECIFICATION.md
- [ ] **Bash integration suite**: No changes needed — N/A (frontend-only)
- [ ] Edge cases explicitly tested — `.catch(() => [])` pattern, envelope unwrapping, stub functions
- [ ] Contract tests: API client tests verify HTTP method, URL, body
- [ ] Coverage threshold (60%): Will increase from current ~83% to ~85%+
- [ ] **Test stubs created BEFORE production code** — Test-first: create test files before composables

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort — 5 phases, ~5 hours total
- [ ] I know which files to create vs. modify — See 02_ARCHITECT_DESIGN.md file-level impact matrix
- [ ] I know which existing patterns to follow — Vitest + vi.mock pattern from existing tests
- [ ] I know how to test — `npm test -- --run`, `npm run lint`, `npm run typecheck`, `npm run build`
- [ ] I have identified the **branch** I will work on — `fix/bp-99-frontend-testing`

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test -- --run` in frontend/)
- [ ] Backend Jest tests still pass — `npm test` (backend/)
- [ ] **Bash integration suite passes** — `bash backend/integration-test/run.sh`
- [ ] Linting passes (`npm run lint` in frontend/)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] **Coverage threshold enforced**: `npm test -- --run --coverage` — must be >= 60%
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed`
  - `PR`
  - `Branch`

## When to Ask the User

1. **Ambiguous acceptance criteria** — N/A (clear test cases defined)
2. **Significant scope change** — If ProjectDetail.vue refactoring is too risky, ask user
3. **Conflicting requirements** — N/A
4. **Unknown unknowns** — If composable extraction breaks template bindings, ask user
5. **Production impact** — N/A (testing work, no production changes)
6. **UI placement decision** — N/A (no UI changes)
7. **Backend API conflict** — N/A (no API changes)
8. **Model can't resolve** — If local tests fail, ask user

---

*This checklist prevents agents from skipping planning.*
