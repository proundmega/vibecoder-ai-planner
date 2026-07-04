# 01_ARCHITECT_REQUIREMENT.md — Fix Frontend Lint Errors

**Status**: completed
**Date created**: 2026-06-22
**Date completed**: 2026-06-22

## Requirement

Fix 6 lint/typecheck errors in 2 files so the frontend build is clean.

## Existing Infrastructure Audit

**Current state**:
- `validator.ts` line 1: imports 5 types never used in the file
- `ProjectDetail.vue` line 205: `handleCreatePR` function defined but never called

**Root cause**:
- Generated types were imported when `validateAndExtract` was typed, but the function uses generic `T` instead
- `handleCreatePR` was added for PR creation UI but the UI was never implemented

## Scope

**In scope**:
- Remove unused import from `validator.ts`
- Remove unused `handleCreatePR` function from `ProjectDetail.vue`

**Out of scope**:
- Adding PR creation UI
- Refactoring error handling patterns
- Other unused code in the codebase

## Acceptance Criteria

- [ ] `cd frontend && npm run lint` — zero errors
- [ ] `cd frontend && npm run typecheck` — zero errors
- [ ] `cd frontend && npm test -- --run` — all 186 tests pass
- [ ] `cd frontend && npm run build` — succeeds
- [ ] No behavioral changes

## Testing Checklist

- [ ] Lint passes with zero errors
- [ ] Typecheck passes with zero errors
- [ ] All existing tests pass (186 tests)
- [ ] Build succeeds

## CI Requirements (MANDATORY)

- `cd frontend && npm run lint` — zero errors
- `cd frontend && npm run typecheck` — zero errors
- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run build` — succeeds
