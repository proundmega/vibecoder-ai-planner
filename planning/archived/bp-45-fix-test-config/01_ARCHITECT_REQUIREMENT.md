# bp-45: Fix Jest/Vitest Config Issues That Cause Fragility

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing
**Priority**: P2
**Effort**: Medium

## Problem Statement

The Jest and Vitest configurations have accumulated fragility:
1. `forceExit: true` is set in Jest config — this masks open handles (unclosed DB pools, timers, sockets) rather than fixing them
2. Spies are not auto-restored between tests, requiring manual `.mockRestore()` calls that are easy to forget
3. `testPathIgnorePatterns` may be misconfigured, allowing integration-only files into unit runs
4. Frontend Vitest config is embedded in `vite.config.ts` without explicit timeout or setup files, causing flaky async failures

## Scope

- **In scope**: Fix Jest config (restoreMocks, forceExit, testPathIgnorePatterns), fix Vitest config (timeout, setup files, environment), clean up manual mock restores in tests
- **Out of scope**: Adding new tests, changing test logic

## Acceptance Criteria

- [ ] `restoreMocks: true` is set in `jest.config.js`; all `.mockRestore()` calls are removed from tests
- [ ] `forceExit: true` is removed from `jest.config.js`; all open handles are fixed (pool.close(), server.close(), timer cleanup)
- [ ] `testPathIgnorePatterns` in all Jest configs correctly excludes integration-only files
- [ ] Frontend `vitest.config.ts` exists with `testTimeout: 10000`, `setupFiles`, `globals: true`, proper `environment`
- [ ] All tests pass without `--forceExit` and without warnings about open handles

## Known Unknowns

- **Open handle sources**: Need to identify all unclosed pg pools, servers, and intervals across test files
- **Integration-only files**: Which files should be excluded from unit runs?

## Decisions Required

1. **Vitest config location?**
   - Option A: `vitest.config.ts` (separate file, clean)
   - Option B: `test` block in `vite.config.ts` (already started, less clean)
   - **Recommendation**: Option A — separate config is easier to read and maintain

2. **Environment for Vitest?**
   - Option A: `'node'` (faster, no DOM simulations)
   - Option B: `'jsdom'` (needed if component tests use DOM APIs)
   - **Recommendation**: Option B — some tests may touch DOM; jsdom is safer

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/jest.config.js` | MODIFY | restoreMocks, remove forceExit, fix testPathIgnorePatterns |
| `backend/jest.setup.js` | MODIFY | Add afterAll to close resources |
| `backend/src/__tests__/*.test.js` | MODIFY | Remove manual .mockRestore() calls |
| `frontend/vitest.config.ts` | CREATE | Dedicated Vitest config |
| `frontend/src/__tests__/vitest.setup.ts` | CREATE | Setup file for globals/imports |
