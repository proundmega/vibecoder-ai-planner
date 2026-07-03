# 03_ARCHITECT_IMPLEMENTATION.md — Jest Config Cleanup

**Status**: planned
**Priority**: P3
**Effort**: Small
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Clean up dead Jest config and enable mock restoration to prevent test pollution and improve test isolation.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

1. **Read jest.config.local.js** — `backend/jest.config.local.js`
   - Verify it's dead config (not referenced anywhere)
   - Note its content for reference
   - *Depends on*: nothing

2. **Delete jest.config.local.js** — `backend/jest.config.local.js`
   - Remove the file
   - *Depends on*: Step 1

3. **Enable restoreMocks** — `backend/jest.config.js`
   - Change `restoreMocks: false` to `restoreMocks: true`
   - *Depends on*: Step 2

4. **Run tests** — verify all tests pass
   - `npm test` — unit tests
   - `npm run test:integration` — integration tests
   - *Depends on*: Step 3

5. **Fix failing tests** — if any test fails due to mock restoration
   - Add `jest.restoreAllMocks()` to `afterEach` in affected test files
   - Or restructure test to not rely on persistent mocks
   - *Depends on*: Step 4

---

### c) Per-File Action Plan

#### `backend/jest.config.local.js` (DELETE)
- Remove file: `rm backend/jest.config.local.js`
- Verify no references: `grep -r "jest.config.local" backend/` returns 0 results

#### `backend/jest.config.js` (MODIFY)
```diff
  module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/*.test.js', '<rootDir>/src/middleware/*.test.js'],
    moduleNameMapper: {
      // ... existing mappings ...
    },
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/jest.setup.js'],
-   restoreMocks: false,
+   restoreMocks: true,
  };
```

---

### d) Dependencies

- No new npm dependencies

---

### e) Risks/Edge Cases

- **[Test regression]**: Some tests may fail when `restoreMocks: true` is enabled. Fix by adding explicit mock cleanup in affected tests.

---

### f) Testing

#### Backend Unit Tests
- [ ] `npm test` — all unit tests pass
- [ ] `npm run test:integration` — integration tests pass
- [ ] If any test fails, fix the test (not the config)

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors

---

### g) Migration Notes

No database migrations. No config changes beyond Jest settings.

---

### h) Files Changed

**Backend:**
```
backend/jest.config.local.js    → DELETE
backend/jest.config.js          → MODIFY (restoreMocks: true)
```

---

### i) Code Review Checklist

- [ ] `jest.config.local.js` deleted
- [ ] `restoreMocks: true` in `jest.config.js`
- [ ] `npm test` passes
- [ ] `npm run test:integration` passes
- [ ] No test file references `jest.config.local.js`

---

### j) Post-Deploy Verification

1. [ ] `npm test` — backend unit tests pass
2. [ ] `npm run test:integration` — backend integration tests pass
3. [ ] `npm run lint` — no lint errors
4. [ ] `grep -r "jest.config.local" backend/` returns 0 results
5. [ ] Tests run in isolation (no mock leakage between test files)
