# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: planned
**Date started**: 2026-08-06
**Date completed**:
**Author**: AI Assistant
**Feature scope**: Both

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [x] I have read `04_SPECIFICATION.md` (if it exists) — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] **Design decisions RESOLVED by user (2026-08-06)**: F1 = Option C (reuse `POST /tickets/:id/messages` with `messageType='feedback'`, frontend-only); F4 = Option A (mount deployments router + fix latent auth bugs: `PROJECT_ADMIN` role-as-code → `PROJECT_UPDATE`, add `TICKET_UPDATE`/`TICKET_STATUS_CHANGE` to unguarded routes)

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists (routes, controllers, services) — YES, all 29 route files inventoried
- [x] I have checked if the **frontend API client** already exists (`frontend/src/api/`) — YES, all 20 modules inventoried
- [x] I have checked if the **frontend UI component/screen** already exists (`frontend/src/views/`, `frontend/src/components/`) — YES, views for all affected features exist
- [x] I have checked if the **router** already has a route for this feature (`frontend/src/router/index.ts`) — YES, all affected views have routes
- [x] I have checked if there are **existing patterns** I should follow — YES, same API client style, same component structure
- [x] I have checked if there are **existing tabs/sections** where this feature could be added — N/A (consistency fixes, no new UI)
- [x] I have checked if the **feature should extend existing code** rather than creating new files — YES, all 7 findings are fixes to existing code
- [x] I have checked if **shared components** exist that I should reuse — N/A

### Both Frontend AND Backend

- [x] If this feature has a **backend API**, I have verified the API route, controller, and service exist or will be created — F1: NEW route needed; F2/F3/F4: routes exist but are NOT mounted
- [x] If this feature has a **frontend UI**, I have identified where it will live — existing views (PhaseFlow, ComputeNodes, ProjectMilestones, TicketDetail)
- [ ] If this feature is **UI only** (no new API), I have verified the existing API clients cover the needed endpoints
- [ ] If this feature is **API only** (no new UI), I have verified the backend routes, controllers, and services are complete
- [x] If this feature affects **both**, I have planned the frontend-backend integration — API client → UI component mapping documented in 03
- [x] I have checked the **OpenAPI spec** (`backend/src/api/openapi-spec.js`) and know if JSDoc annotations are needed — F6 requires JSDoc review
- [x] I have checked if **generated TypeScript types** (`frontend/src/api/generated/`) need regeneration — YES, F6
- [x] I have checked if **frontend API response validation** (`frontend/src/api/validator.ts`) needs updating — YES, F1 (feedback response)

### Dependency Analysis

- [ ] All new npm/system dependencies are listed with versions and purpose — NONE expected
- [x] All existing services/modules that will be affected are identified — PhaseService (F1), compute-nodes/milestones/deployments routers (F2-F4), ticketPlanning controllers (F5), openapi generation (F6)
- [ ] Breaking changes are noted (API contract changes, DB migration, config format) — NONE expected (all fixes restore intended behavior)
- [ ] No circular dependencies introduced

### Configuration Audit

- [x] All new environment variables are documented with defaults — NONE (F7 is proxy config only, no env vars)
- [ ] All new config files or schema changes are documented — NONE expected
- [x] Backward compatibility maintained (old config still works) — YES

### Database & Migration

- [x] If DB changes needed: migration file exists with both `up` and `rollback` SQL — NONE needed (all fixes are route/wiring/URL level)
- [x] Migration order is correct (added to `backend/src/migrations/apply.js` in the right position) — N/A
- [x] Rollback is tested (can reverse without data loss) — N/A
- [x] No breaking schema changes without a migration path for existing data — N/A

### Testing Strategy

- [x] Unit test files identified per changed module — documented in 03 (PhaseService feedback tests, route mount tests in `routeOrdering.test.js`, frontend client URL tests)
- [ ] Backend Jest integration tests: scenarios defined for `jest.integration.config.js`
- [ ] **Bash integration suite**: test added or extended in `backend/integration-test/suites/` (for backend API changes — F2, F3, F4)
- [x] Edge cases explicitly tested (not just happy path) — documented in 03
- [ ] If frontend: component tests for new UI, E2E for user flows — N/A (no new UI)
- [x] Contract tests: `frontend/src/__tests__/api-contract.test.ts` updated if response shapes changed — F1
- [x] Response validation: `frontend/src/api/validator.ts` updated if response shapes changed — F1
- [ ] **Test stubs created BEFORE production code** — if `04_SPECIFICATION.md` exists, stub files are the first file operations, listed under "Test Expectations"
- [ ] New test files CREATED for all new/changed code (not just verifying existing tests pass)
- [ ] **Regression test added for every bug fix** (reproduces the original failure condition) — MANDATORY per bug-fix protocol; one per finding
- [ ] **Coverage threshold (60%)**: run `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — CI enforces 60% min on lines, functions, branches, statements

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort — Medium
- [x] I know which files to create vs. modify — documented in 03
- [x] I know which existing patterns to follow (naming, structure, error handling)
- [x] I know how to test (unit, integration, frontend, E2E)
- [x] I have identified the **branch** I will work on — `fix/fg-13-fe-be-inconsistencies`

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [ ] All unit tests pass (`npm test` in relevant directory)
- [ ] Backend Jest integration tests pass (`npm run test:integration` if applicable)
- [ ] **Bash integration suite passes** (`cd backend && bash integration-test/run.sh --only` for backend API changes)
- [ ] Linting passes (`npm run lint` in relevant directory)
- [ ] Frontend typecheck passes (`npm run typecheck`)
- [ ] Frontend build passes (`npm run build`)
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — must pass 60% min on lines, functions, branches, statements
- [ ] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [ ] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [ ] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed` — when implementation finishes
  - `PR` — PR URL after merge
  - `Branch` — git branch used
- [ ] `04_SPECIFICATION.md` (if created) reflects the final implementation — not just the plan
- [ ] New env vars added to `backend/.env.example` if applicable — N/A
- [ ] Generated files (OpenAPI types, etc.) regenerated if applicable:
  - `cd frontend && npm run generate:spec && npm run generate:api`
- [ ] Generated types compile: `cd frontend && npm run typecheck`
- [ ] OpenAPI JSDoc annotations added to backend routes if applicable — F2, F3, F4
- [ ] Frontend API response validation updated if response shapes changed — F1
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

**For this ticket**: both previously-open design decisions are RESOLVED (F1 = Option C, F4 = Option A, user-confirmed 2026-08-06). Remaining user-input triggers are only the generic ones above (scope change, production impact, etc.).

Do NOT guess. Do NOT assume. Ask the user.

---

*This checklist prevents agents from skipping planning and jumping straight to coding. Always audit existing infrastructure before creating new code.*
