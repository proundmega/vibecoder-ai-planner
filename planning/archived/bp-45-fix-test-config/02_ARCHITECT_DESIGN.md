# bp-45: Fix Jest/Vitest Config Issues That Cause Fragility — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing

## Current State

### Backend Jest Issues

1. **`jest.config.js`**:
   ```javascript
   forceExit: true,        // masks open handles
   // restoreMocks: not set  (default: false)
   ```
2. `jest.setup.js` mocks pg pool but does not close it
3. Many test files call `mockRestore()` manually:
   ```javascript
   afterEach(() => {
     jest.restoreAllMocks();
   });
   ```
   Or per-test:
   ```javascript
   someMock.mockRestore();
   ```
4. `testPathIgnorePatterns` may include wrong patterns

### Frontend Vitest Issues

1. No explicit `testTimeout` (default 5000ms — flaky for async tests)
2. No explicit `setupFiles`
3. No `globals: true` — requires explicit `import { vi, describe, it, expect }` in every file
4. No separate `vitest.config.ts`

## Proposed Solution

### Backend Fixes

1. **`jest.config.js`**:
   ```javascript
   restoreMocks: true,
   // remove: forceExit: true,
   ```
2. **`jest.setup.js`**: Add:
   ```javascript
   afterAll(async () => {
     // close any open resources
     const { pool } = require('db');
     if (pool && typeof pool.end === 'function') {
       await pool.end();
     }
   });
   ```
3. **Test files**: Remove all manual `mockRestore()` calls — `restoreMocks: true` handles it automatically
4. **Verify `testPathIgnorePatterns`**:
   - Should exclude: `integration/`, `__tests__/integration/`
   - Should include: `src/__tests__/*.test.js`

5. **Fix open handles**:
   - pg Pool: mocked in jest.setup.js — ensure mock has `end()` that resolves
   - Server sockets: any test calling `server.close()` should await it
   - Timers: use `jest.useFakeTimers()` with proper cleanup

### Frontend Fixes

1. **Create `vitest.config.ts`**:
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

2. **Create `src/__tests__/vitest.setup.ts`**:
   ```typescript
   // global test setup — currently empty, ready for future additions
   ```

3. **Update tsconfig** if needed (add vitest types)

## Alternatives Considered

- **Keep `forceExit: true`**: Rejected — it hides real bugs (unclosed connections cause flaky CI)
- **Keep Vitest in `vite.config.ts`**: Rejected — mixing build and test config creates confusion

## File-Level Impact Matrix

| File | Action | Details |
|------|--------|---------|
| `backend/jest.config.js` | MODIFY | Set restoreMocks: true, remove forceExit, fix testPathIgnorePatterns |
| `backend/jest.setup.js` | MODIFY | Add afterAll to close pool |
| `backend/src/__tests__/*.test.js` | MODIFY | Remove manual mockRestore() calls |
| `frontend/vitest.config.ts` | CREATE | Dedicated test config |
| `frontend/src/__tests__/vitest.setup.ts` | CREATE | Setup file |
