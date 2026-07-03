# 02_ARCHITECT_DESIGN.md — Jest Config Cleanup

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Two Jest configuration issues degrade test quality and developer experience:
1. A dead `jest.config.local.js` file creates confusion about which config is active
2. `restoreMocks: false` causes mocks to persist across test files, leading to test pollution and flaky tests

---

## Current State

### Dead Config (`jest.config.local.js`)
- File exists at `backend/jest.config.local.js` (489 bytes)
- NOT referenced by any `package.json` script
- NOT referenced by any CI config
- NOT mentioned in `AGENTS.md`
- Likely created for local debugging and abandoned

### Mock Restoration (`jest.config.js:19`)
```javascript
module.exports = {
  // ...
  restoreMocks: false,  // mocks persist across tests
  // ...
};
```

With `restoreMocks: false`:
- `jest.spyOn()` and `jest.fn()` mocks persist across test files
- Tests must manually call `jest.restoreAllMocks()` in `afterEach`
- If a test forgets to clean up, the mock leaks to the next test
- This is the #1 cause of flaky tests in Jest

---

## Design

### Option A: Delete + Enable (Recommended)

1. Delete `jest.config.local.js`
2. Change `restoreMocks: false` to `restoreMocks: true` in `jest.config.js`

This is the simplest fix. `restoreMocks: true` is the Jest recommended default and ensures test isolation.

### Option B: Keep Config File, Enable restoreMocks

Keep `jest.config.local.js` and have it override `restoreMocks: true`. This preserves the file in case someone wants to use it for local debugging.

**Decision**: Option A is recommended. The local config file is dead code. If developers need local overrides, they can use `--config` flag with `npm test`.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/jest.config.local.js` | DELETE | Remove dead config file |
| `backend/jest.config.js` | MODIFY | Line 19: `restoreMocks: false` → `restoreMocks: true` |

---

## Dependencies

- No new npm dependencies
- No config changes beyond Jest settings

---

## Config / Environment Changes

- No new environment variables
- No config changes

---

## Security Considerations

- [x] No security impact — this is test configuration only

---

## Risks and Edge Cases

### Backend Risks
- **[Test regression]**: Some tests may rely on mocks persisting across test files. Enabling `restoreMocks: true` will cause these tests to fail. — Fix: update the affected tests to explicitly restore/restore mocks in `afterEach`.

### Edge Cases
- **[Mocked modules in setupFilesAfterEnv]**: The Jest setup file mocks `pg`, `winston`, `bcryptjs`, `uuid`, and `jsonwebtoken`. With `restoreMocks: true`, these mocks are restored after each test. This is the desired behavior — each test gets a fresh mock.

---

## Alternative Designs Considered

### Alternative 1: Add restoreAllMocks to afterEach in each test file
- **Pros**: More explicit control per test
- **Cons**: Duplicates cleanup logic across 20+ test files; easy to forget
- **Decision**: `restoreMocks: true` in config is cleaner and ensures consistency.

### Alternative 2: Use jest-circus runner
- **Pros**: Better isolation by default
- **Cons**: Requires changing `testRunner` in Jest config; more invasive change
- **Decision**: `restoreMocks: true` is sufficient. jest-circus is a future improvement.
