# 03_ARCHITECT_IMPLEMENTATION.md — Frontend Testing Strategy

**Status**: pending
**Date started**: 2026-07-17

---

## Implementation Plan

### Phase 1: Pure Utility Tests (30 min)

1. Create `src/__tests__/diff.test.ts` — 9 test cases for `countLines` and `computePatch`
2. Run `npm test -- --run src/__tests__/diff.test.ts` — verify all pass
3. Run `npm run lint` — verify no lint errors

### Phase 2: API Client Contract Tests (1 hour)

Create 5 contract test files, each following the pattern from `client.test.js`:

1. `src/__tests__/api-computeNodes.test.ts` — 6 tests (one per function)
2. `src/__tests__/api-credentials.test.ts` — 4 tests (+ edge case for `.catch()`)
3. `src/__tests__/api-deployments.test.ts` — 7 tests
4. `src/__tests__/api-milestones.test.ts` — 5 tests
5. `src/__tests__/api-review.test.ts` — 5 tests (+ edge case for envelope unwrapping)

Run `npm test -- --run src/__tests__/api-*.test.ts` — verify all pass.

### Phase 3: Composable Extraction (2 hours)

3a. **Extract `useGitHub`** from `ProjectDetail.vue`
- Copy the 14 reactive refs + 6 async functions into `src/composables/useGitHub.ts`
- Replace `githubRepo`, `githubLoading`, etc. with composable return values
- Update template bindings (e.g., `githubRepo` → `github.repo`)

3b. **Extract `useUsage`** from `ProjectDetail.vue`
- Copy 6 reactive refs + 2 async functions into `src/composables/useUsage.ts`
- Replace inline variables with composable return values

3c. **Extract `useMemory`** from `ProjectDetail.vue`
- Copy 11 reactive refs + 6 async functions into `src/composables/useMemory.ts`
- Replace inline variables with composable return values

3d. **Extract `useTabNavigation`** from `ProjectDetail.vue`
- Copy tab array + `switchTab` into `src/composables/useTabNavigation.ts`
- Replace inline tab logic with composable

3e. **Refactor `ProjectDetail.vue`**
- Import all 4 composables
- Replace ~200 lines of inline script with composable calls
- Verify template bindings update correctly

### Phase 4: Composable Tests (1 hour)

1. `src/__tests__/useGitHub.test.ts` — 5 tests
2. `src/__tests__/useUsage.test.ts` — 3 tests
3. `src/__tests__/useMemory.test.ts` — 6 tests
4. `src/__tests__/useTabNavigation.test.ts` — 3 tests

### Phase 5: Verification (30 min)

1. `npm test -- --run` — all 45+ existing tests pass
2. `npm test -- --run --coverage` — coverage stays above 60%
3. `npm run lint` — 0 warnings
4. `npm run typecheck` — 0 errors
5. `npm run build` — builds successfully

## Testing Steps

After each phase, run:
```bash
cd frontend
npm run lint
npm test -- --run
```

After all phases:
```bash
npm test -- --run --coverage
npm run typecheck
npm run build
```

## Rollback Plan

If `ProjectDetail.vue` refactoring breaks things:
1. Revert `ProjectDetail.vue` to original
2. Keep the composables and tests (they still add value)
3. The composables can be integrated later when there's time for careful refactoring
