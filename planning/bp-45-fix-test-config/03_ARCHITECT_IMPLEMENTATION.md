# bp-45: Fix Jest/Vitest Config Issues That Cause Fragility — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Scope**: Testing

## Purpose
Fix Jest and Vitest configuration to reduce test fragility and eliminate open handles.

## Implementation Order

1. **Backend: Fix `jest.config.js`**
   - Add `restoreMocks: true`
   - Remove `forceExit: true`
   - Verify `testPathIgnorePatterns`

2. **Backend: Fix `jest.setup.js`**
   - Add `afterAll` hook to close pool
   - Ensure pool mock has `end()` method

3. **Backend: Remove manual mockRestore calls**
   - Search all `*.test.js` files for `.mockRestore()` calls
   - Remove them (restoreMocks auto-handles)

4. **Backend: Fix open handles**
   - Find sources: `git grep "setInterval\|setTimeout\|server\.listen\|pool\.connect"`
   - Mock or cleanup each one

5. **Frontend: Create `vitest.config.ts`**
6. **Frontend: Create `vitest.setup.ts`**
7. **Run full test suite** — verify no forceExit needed

## Per-File Action Plan

### `backend/jest.config.js` (MODIFY)
```javascript
module.exports = {
  // ... existing ...
  restoreMocks: true,
  // forceExit: true,    ← REMOVE
  testPathIgnorePatterns: [
    '/node_modules/',
    '/integration/',
    '/__tests__/integration/',
  ],
};
```

### `backend/jest.setup.js` (MODIFY)
Add at the end:
```javascript
afterAll(async () => {
  // Give any pending teardowns a chance to complete
  await new Promise(setImmediate);
});
```

Also ensure the pg mock has an `end()` that resolves:
```javascript
jest.mock('pg', () => {
  const mPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(),
  };
  return { Pool: jest.fn(() => mPool) };
});
```

### `backend/src/__tests__/*.test.js` (MODIFY)
Search for patterns:
- `mockRestore()`
- `jest.restoreAllMocks()`
- `jest.resetAllMocks()`

Remove any calls that exist solely to reset mocks between tests. If a test intentionally resets a mock to change behavior mid-test, keep it (rare).

### `frontend/vitest.config.ts` (CREATE)
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/vitest.setup.ts'],
    testTimeout: 10000,
  },
});
```

### `frontend/src/__tests__/vitest.setup.ts` (CREATE)
```typescript
// Global Vitest setup
// Currently empty — add polyfills or global mocks here as needed
```

## Migration Plan
No database changes.

## Test Plan
1. Run `npm test` in backend — must pass without `--forceExit`
2. Run `npx jest --detectOpenHandles` — verify no open handles reported
3. Run `npm test -- --run` in frontend — must pass
4. Verify all frontend tests pass with `globals: true` (remove `import { describe, it, expect }` from files if needed)

## Rollback Steps
1. Revert jest.config.js (restore forceExit, remove restoreMocks)
2. Revert jest.setup.js
3. Delete vitest.config.ts and vitest.setup.ts
4. Restore manual mockRestore() calls from git history
