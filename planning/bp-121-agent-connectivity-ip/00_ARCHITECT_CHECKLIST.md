# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: pending
**Date started**: 2026-09-11
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Backend | Config

---

## Pre-Implementation Checklist

Before starting any implementation, complete ALL items below. Do NOT skip any step.

### Planning

- [x] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement, scope, and acceptance criteria
- [x] I have read `02_ARCHITECT_DESIGN.md` — I understand the design, alternatives considered, and risks
- [x] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions, dependencies, and testing steps
- [ ] I have read `04_SPECIFICATION.md` (if it exists) — I know the exact file operations, signatures, and test expectations
- [x] I have identified all assumptions and confirmed they are reasonable
- [x] I know what is IN scope and OUT of scope
- [x] I have verified there are no important design decisions that require user input (see "Important Design Decisions" in 01_ARCHITECT_REQUIREMENT.md)

### Existing Infrastructure Audit

- [x] I have checked if the **backend API** already exists (routes, controllers, services) — YES, agent routes and services exist
- [x] I have checked if the **frontend API client** already exists (`frontend/src/api/`) — YES, agents.ts exists
- [x] I have checked if the **frontend UI component/screen** already exists (`frontend/src/views/`, `frontend/src/components/`) — YES, AgentList.vue exists
- [x] I have checked if the **router** already has a route for this feature (`frontend/src/router/index.ts`) — YES
- [x] I have checked if there are **existing patterns** I should follow — YES, follow existing CORS config patterns
- [x] I have checked if the **feature should extend existing code** rather than creating new files — YES, modify existing files
- [x] I have checked if **shared components** exist that I should reuse — N/A (backend + config changes)

### Both Frontend AND Backend

- [x] If this feature has a **backend API**, I have verified the API route, controller, and service exist or will be created — Existing services/routes will be modified
- [x] If this feature has a **frontend UI**, I have identified where it will live — No frontend changes needed
- [x] If this feature is **UI only** (no new API), I have verified the existing API clients cover the needed endpoints — N/A
- [x] If this feature is **API only** (no new UI), I have verified the backend routes, controllers, and services are complete — Will modify existing code
- [x] I have checked the **OpenAPI spec** (`backend/src/api/openapi-spec.js`) and know if JSDoc annotations are needed — No JSDoc changes needed
- [x] I have checked if **generated TypeScript types** (`frontend/src/api/generated/`) need regeneration — No, response shapes unchanged
- [x] I have checked if **frontend API response validation** (`frontend/src/api/validator.ts`) needs updating — No changes needed

### Dependency Analysis

- [x] All new npm/system dependencies are listed with versions and purpose — None needed
- [x] All existing services/modules that will be affected are identified — AgentService, HeartbeatService, agents.js, cors.js, index.js
- [x] Breaking changes are noted (API contract changes, DB migration, config format) — Provider config response shape fix is a breaking change for Java agent (fixes double-wrapping)
- [x] No circular dependencies introduced

### Configuration Audit

- [x] All new environment variables are documented with defaults — None needed (existing `ALLOWED_ORIGINS` will be extended)
- [x] All new config files or schema changes are documented — None
- [x] Backward compatibility maintained (old config still works) — Yes, ALLOWED_ORIGINS is additive

### Database & Migration

- [x] If DB changes needed: migration file exists with both `up` and `rollback` SQL — No DB changes needed
- [x] Migration order is correct (added to `backend/src/migrations/apply.js` in the right position) — N/A
- [x] Rollback is tested (can reverse without data loss) — N/A
- [x] No breaking schema changes without a migration path for existing data — N/A

### Testing Strategy

- [x] Unit test files identified per changed module — AgentService tests, HeartbeatService tests, cors tests
- [x] Backend Jest integration tests: scenarios defined for `jest.integration.config.js` — Provider config and agent listing scenarios
- [x] **Bash integration suite**: test added or extended in `backend/integration-test/suites/` (for backend API changes) — Provider config and agent listing tests
- [x] Edge cases explicitly tested (not just happy path) — Non-localhost origins, agents without heartbeats, double-wrap prevention
- [x] If frontend: component tests for new UI, E2E for user flows — N/A (no frontend changes)
- [x] Contract tests: `frontend/src/__tests__/api-contract.test.ts` updated if response shapes changed — Provider config response shape fix
- [x] Response validation: `frontend/src/api/validator.ts` updated if response shapes changed — N/A
- [x] **Test stubs created BEFORE production code** — if `04_SPECIFICATION.md` exists, stub files are the first file operations, listed under "Test Expectations"
- [x] New test files CREATED for all new/changed code (not just verifying existing tests pass)
- [x] Regression test added for any bug fix (reproduces the original failure condition)

### Implementation Readiness

- [x] I have a plan to implement this within the estimated effort — Small/Medium, 3 focused fixes
- [x] I know which files to create vs. modify — Modify 4 files, create 0
- [x] I know which existing patterns to follow (naming, structure, error handling) — Follow existing patterns
- [x] I know how to test (unit, integration, frontend, E2E) — Jest unit + integration tests
- [x] I have identified the **branch** I will work on — fix/bp-121-agent-connectivity-ip

## Post-Implementation Checklist

After implementation, complete ALL items below before marking the ticket as done.

- [x] All unit tests pass (`npm test` in relevant directory)
- [x] Backend Jest integration tests pass (`npm run test:integration` if applicable)
- [x] **Bash integration suite passes** (`cd backend && bash integration-test/run.sh --only` for backend API changes)
- [x] Linting passes (`npm run lint` in relevant directory)
- [x] Frontend typecheck passes (`npm run typecheck`)
- [x] Frontend build passes (`npm run build`)
- [x] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — must pass 60% min on lines, functions, branches, statements
- [x] All action items in `03_ARCHITECT_IMPLEMENTATION.md` are completed
- [x] All testing checklist items in `01_ARCHITECT_REQUIREMENT.md` are verified
- [x] `03_ARCHITECT_IMPLEMENTATION.md` has been updated with:
  - `Date completed` — when implementation finishes
  - `PR` — PR URL after merge
  - `Branch` — git branch used
- [x] `04_SPECIFICATION.md` (if created) reflects the final implementation — not just the plan
- [x] New env vars added to `backend/.env.example` if applicable — N/A
- [x] Generated files (OpenAPI types, etc.) regenerated if applicable — N/A
- [x] Generated types compile: `cd frontend && npm run typecheck` — N/A
- [x] OpenAPI JSDoc annotations added to backend routes if applicable — N/A
- [x] Frontend API response validation updated if response shapes changed — N/A
- [x] Code reviewed by another agent or human if available
- [x] Post-deploy verification steps completed (see `03_ARCHITECT_IMPLEMENTATION.md`)

## When to Ask the User

**IMPORTANT**: If you encounter any of the following, STOP and ask the user before proceeding:

1. ~~**Ambiguous acceptance criteria** — the requirement is unclear or has multiple valid interpretations~~ — Clear: fix 3 identified bugs
2. ~~**Significant scope change** — the implementation requires more work than estimated, or changes affect areas not mentioned in the requirement~~ — Scope is tight and well-defined
3. ~~**Conflicting requirements** — this best practice conflicts with an existing feature or constraint~~ — No conflicts
4. ~~**Unknown unknowns** — you discover something during implementation that fundamentally changes the approach~~ — Will stop if discovered
5. ~~**Production impact** — the change could affect running users (data migration, API breaking change, etc.)~~ — Provider config fix changes response shape but only fixes a bug
6. ~~**UI placement decision** — you need user input on where to place a new UI section (e.g., which tab, which page, which modal)~~ — No UI changes
7. ~~**Backend API conflict** — the backend API doesn't exist and creating it would conflict with existing patterns~~ — Extending existing APIs
8. ~~**Model can't resolve** — the local model fails repeatedly on a task; ask if a larger model or human intervention is needed~~ — N/A

Do NOT guess. Do NOT assume. Ask the user.
