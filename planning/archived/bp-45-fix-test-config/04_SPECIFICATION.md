# bp-45: Fix Jest/Vitest Config Issues That Cause Fragility — Spec

**Target model**: 7B–14B (JavaScript, TypeScript)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/jest.config.js`

**Changes**:
```javascript
module.exports = {
  // ... keep all existing ...
  restoreMocks: true,
  // Remove: forceExit: true,

  testPathIgnorePatterns: [
    '/node_modules/',
    '/integration/',
    '/__tests__/integration/',
  ],
};
```

### MODIFY: `backend/jest.setup.js`

**Add after existing mocks**:
```javascript
afterAll(async () => {
  await new Promise(setImmediate);
});
```

**Modify pg mock** to add `end()`:
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

### MODIFY: `backend/src/__tests__/*.test.js`

**Search and remove**:
- `jest.restoreAllMocks()` in `afterEach` blocks
- `someMock.mockRestore()` in `afterEach` or individual tests
- `jest.resetAllMocks()` — only if it duplicates what `restoreMocks: true` does

Keep any `mockReset()` or `mockImplementation()` calls that change mock behavior mid-test.

### CREATE: `frontend/vitest.config.ts`

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

### CREATE: `frontend/src/__tests__/vitest.setup.ts`

```typescript
// Global test setup for Vitest
// Add polyfills or global stubs here
```

## Test Expectations

```
✓ Backend: npm test passes without --forceExit
✓ Backend: npx jest --detectOpenHandles reports 0 open handles
✓ Backend: All .mockRestore() calls removed — no test relies on manual restore
✓ Frontend: npm test -- --run passes with new vitest.config.ts
✓ Frontend: globals: true allows describe/it/expect without imports
```

## Edge Cases

1. **Test file does manual mockReset mid-test**: Keep it — `restoreMocks` only restores after the test ends
2. **Pool mock does not have end()**: Added explicitly in jest.setup.js above
3. **Vitest globals conflict with imports**: Remove `import { describe, it, expect }` from test files that were importing them
4. **jsdom vs node**: If a test reads `window` or `document`, use `jsdom`; if not, may switch to `node` for speed
