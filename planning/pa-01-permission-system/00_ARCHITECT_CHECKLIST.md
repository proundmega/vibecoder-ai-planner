# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: {{DATE}}
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend | Frontend | Both

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
- [ ] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [ ] I have checked if the **backend API** already exists (routes, controllers, services)
- [ ] I have checked if the **frontend API client** already exists (`frontend/src/api/`)
- [ ] I have checked if the **frontend UI component/screen** already exists (`frontend/src/views/`, `frontend/src/components/`)
- [ ] I have checked if the **router** already has a route for this feature (`frontend/src/router/index.ts`)
- [ ] I have checked if there are **existing patterns** I should follow (same API client style, same component structure, same naming conventions)
- [ ] I have checked if there are **existing tabs/sections** where this feature could be added (e.g., ProjectDetail tabs, navigation menus)
- [ ] I have checked if the **feature should extend existing code** rather than creating new files (e.g., add a tab to ProjectDetail vs. create a new page)
- [ ] I have checked if **shared components** exist that I should reuse (e.g., modals, tables, cards)

### Both Frontend AND Backend

- [ ] If this feature has a **backend API**, I have verified the API route, controller, and service exist or will be created
- [ ] If this feature has a **frontend UI**, I have identified where it will live (which view, which tab, which modal)
- [ ] If this feature is **UI only** (no new API), I have verified the existing API clients cover the needed endpoints
- [ ] If this feature is **API only** (no new UI), I have verified the backend routes, controllers, and services are complete
- [ ] If this feature affects **both**, I have planned the frontend-backend integration (API client → UI component)
- [ ] I have checked the **OpenAPI spec** (`backend/src/api/openapi-spec.js`) and know if JSDoc annotations are needed
- [ ] I have checked if **generated TypeScript types** (`frontend/src/api/generated/`) need regeneration
- [ ] I have checked if **frontend API response validation** (`frontend/src/api/validator.ts`) needs updating

### Dependency Analysis

- [ ] All new npm/system dependencies are listed with versions and purpose
- [ ] All existing services/modules that will be affected are identified
- [ ] Breaking changes are noted (API contract changes, DB migration, config format)
- [ ] No circular dependencies introduced

### Configuration Audit

- [ ] All new environment variables are documented with defaults
- [ ] All new config files or schema changes are documented
- [ ] Backward compatibility maintained (old config still works)

### Database & Migration

- [ ] If DB changes needed: migration file exists with both `up` and `rollback` SQL
- [ ] Migration order is correct (added to `backend/src/migrations/apply.js` in the right position)
- [ ] Rollback is tested (can reverse without data loss)
- [ ] No breaking schema changes without a migration path for existing data

### Testing Strategy

- [ ] Unit test files identified per changed module
- [ ] Backend Jest integration tests: scenarios defined for `jest.integration.config.js`
- [ ] **Bash integration suite**: test added or extended in `backend/integration-test/suites/` (for backend API changes)
- [ ] Edge cases explicitly tested (not just happy path)
- [ ] If frontend: component tests for new UI, E2E for user flows
- [ ] Contract tests: `frontend/src/__tests__/api-contract.test.ts` updated if response shapes changed
- [ ] Response validation: `frontend/src/api/validator.ts` updated if response shapes changed
- [ ] New test files CREATED for all new/changed code (not just verifying existing tests pass)
- [ ] Regression test added for any bug fix (reproduces the original failure condition)
- [ ] Code coverage: no significant decrease in changed modules (run `npm run test:coverage` to verify)

### Implementation Readiness

- [ ] I have a plan to implement this within the estimated effort
- [ ] I know which files to create vs. modify
- [ ] I know which existing patterns to follow (naming, structure, error handling)
- [ ] I know how to test (unit, integration, frontend, E2E)
- [ ] I have identified the **branch** I will work on

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test` in relevant directory)
- [ ] Backend Jest integration tests pass (`npm run test:integration` if applicable)
- [ ] **Bash integration suite passes** (`cd backend && bash integration-test/run.sh --only` for backend API changes)
- [ ] Linting passes (`npm run lint` in relevant directory)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] Code coverage checked: no significant decrease in changed modules
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed` — when implementation finishes
  - `PR` — PR URL after merge
  - `Branch` — git branch used
- [ ] `04_SPECIFICATION.md` (if created) reflects the final implementation — not just the plan
- [ ] New env vars added to `backend/.env.example` if applicable
- [ ] Generated files (OpenAPI types, etc.) regenerated if applicable:
  - `cd frontend && npm run generate:spec && npm run generate:api`
- [ ] Generated types compile: `cd frontend && npm run typecheck`
- [ ] OpenAPI JSDoc annotations added to backend routes if applicable
- [ ] Frontend API response validation updated if response shapes changed
- [ ] Code reviewed by another agent or human if available
- [ ] Post-deploy verification steps completed (see `03_ARCHITECT_IMPLEMENTATION.md`)

## When to Ask the User

**IMPORTANT**: If you encounter any of the following, STOP and ask the user before proceeding:

1. **Ambiguous acceptance criteria** — the requirement is unclear or has multiple valid interpretations
2. **Significant scope change** — the implementation requires more work than estimated, or changes affect areas not mentioned in the requirement
3. **Conflicting requirements** — this best practice conflicts with an existing feature or constraint
4. **Unknown unknowns** — you discover something during implementation that fundamentally changes the approach
5. **Production impact** — the change could affect running users (data migration, API breaking change, etc.)
6. **UI placement decision** — you need user input on where to place a new UI section (e.g., which tab, which page, which modal)
7. **Backend API conflict** — the backend API doesn't exist and creating it would conflict with existing patterns
8. **Model can't resolve** — the local model fails repeatedly on a task; ask if a larger model or human intervention is needed

Do NOT guess. Do NOT assume. Ask the user.

---

*This checklist prevents agents from skipping planning and jumping straight to coding. Always audit existing infrastructure before creating new code.*
