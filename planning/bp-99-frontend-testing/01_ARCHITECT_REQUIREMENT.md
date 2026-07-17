# 01_ARCHITECT_REQUIREMENT.md — Frontend Testing Strategy

**Status**: pending
**Date started**: 2026-07-17
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Feature scope**: Frontend tests only

---

## Problem

Frontend has 45 test files covering ~23% of the codebase. The remaining 77% is untested — mostly views (20 files), components (6 files), and API clients (5 files). Coverage threshold is 60%, currently passing only because untested files are excluded.

The real gap: **no tests for pure logic** (diff utils), **no contract tests for API clients**, and **no tests for business logic extracted from god-components** like `ProjectDetail.vue` (1128 lines).

## Scope

### In Scope

1. **`src/utils/diff.ts`** — Pure utility functions (`countLines`, `computePatch`). Add unit tests.
2. **5 API client files** — Contract tests verifying correct HTTP method, URL, and body:
   - `src/api/computeNodes.ts`
   - `src/api/credentials.ts`
   - `src/api/deployments.ts`
   - `src/api/milestones.ts`
   - `src/api/review.ts`
3. **Extract `ProjectDetail.vue` logic into composables**, then test the composables:
   - `useGitHub(projectId)` — GitHub repo connect/disconnect/branch/PR operations
   - `useUsage(projectId)` — Usage and billing data loading
   - `useMemory(projectId)` — Memory CRUD + search
   - `useTabNavigation(projectId)` — Tab switching with lazy loading

### Out of Scope

- Unit tests for Vue views (too expensive, low ROI)
- Unit tests for UI components (already at 100% coverage)
- Cypress E2E tests (separate effort)
- Tests for `src/composables/aiChatDataSource.ts` (file does not exist)
- Refactoring other large views (TicketDetail.vue, AgentList.vue, etc.)

## Acceptance Criteria

1. `diff.ts` has unit tests covering `countLines` (4 test cases) and `computePatch` (5 test cases)
2. All 5 API client files have contract tests verifying HTTP calls (25+ test cases total)
3. `useGitHub`, `useUsage`, `useMemory`, `useTabNavigation` composables exist and are tested
4. `ProjectDetail.vue` is refactored to use the new composables (logic moved out)
5. Frontend coverage stays above 60%
6. All existing tests still pass
7. `npm run lint` and `npm run typecheck` pass

## Important Design Decisions

1. **Extract composables BEFORE writing tests** — composables are pure logic, easy to test. Views with router/Vuex integration are hard to test.
2. **API client tests mock `@/api/client`** — same pattern as existing `client.test.js`. No actual HTTP calls.
3. **Keep `ProjectDetail.vue` working** — extract logic, replace inline code with composable calls, verify no visual regression.

## Deferred Improvements

- Extract logic from `TicketDetail.vue` (1190 lines) into composables
- Extract logic from `AgentList.vue` (93 lines, partially tested) into composables
- Add Cypress E2E tests for critical flows (login → create project → create ticket → assign agent)
- Test remaining API clients (agents.ts, approvals.ts, auth.ts, billing.ts, etc.)
