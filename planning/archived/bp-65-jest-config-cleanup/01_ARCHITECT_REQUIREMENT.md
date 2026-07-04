# 01_ARCHITECT_REQUIREMENT.md — Jest Config Cleanup

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P3
**Effort**: Small

---

## Requirement

Clean up two Jest configuration issues that cause test pollution and developer confusion:
1. **Remove `jest.config.local.js`** — a dead config file not referenced by any npm script, CI config, or documentation
2. **Enable `restoreMocks: true`** in `jest.config.js` — currently set to `false`, which causes mocks to persist across tests and leads to test pollution

**Problem**: 
1. `jest.config.local.js` (489 bytes) exists in `backend/` but is never referenced. It creates confusion for developers and agents who may try to use it. It was likely created for local debugging and abandoned.
2. `restoreMocks: false` in `jest.config.js` means `jest.restoreAllMocks()` is NOT called between tests. This causes mocks to leak between tests, making tests non-isolated and flaky. When one test mocks `pool.query()`, that mock persists to the next test unless explicitly cleaned up.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Jest Config Check
- [x] `jest.config.local.js` exists (489 bytes) — content needs verification
- [x] `jest.config.local.js` is NOT in any `package.json` scripts
- [x] `jest.config.local.js` is NOT in `.github/workflows/ci.yml`
- [x] `jest.config.local.js` is NOT mentioned in `AGENTS.md`
- [x] `jest.config.js` line 19: `restoreMocks: false`
- [x] `jest.config.js` uses `restoreMocks: false` — mocks persist across test files

### Test Coverage Check
- [x] Jest `testMatch`: `**/__tests__/*.test.js` + `<rootDir>/src/middleware/*.test.js`
- [x] Jest `setupFilesAfterEnv`: mocks all external deps (pg, winston, bcryptjs, uuid, jsonwebtoken)
- [x] `jest.config.local.js` may extend or override `jest.config.js` — need to check content

---

## Scope

### In Scope
- Delete `backend/jest.config.local.js` — it's dead config
- Change `restoreMocks: false` to `restoreMocks: true` in `backend/jest.config.js`
- Run `npm test` to verify all tests still pass with `restoreMocks: true`
- Update `AGENTS.md` if it documents `jest.config.local.js`

### Out of Scope
- Restructuring Jest config files
- Adding new Jest configuration options
- Changing test files (only config changes)
- Fixing test pollution in individual tests (covered by enabling restoreMocks)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/jest.config.local.js` | DELETE | Remove dead config file |
| `backend/jest.config.js` | MODIFY | `restoreMocks: false` → `restoreMocks: true` |
| `AGENTS.md` | NONE | Verify no mention of jest.config.local.js |

---

## Known Unknowns

1. **[jest.config.local.js content]**: What does this file contain? Is it an extension of the main config? — Need to read it before deleting to ensure nothing critical is lost.
2. **[Test pollution with restoreMocks: true]**: Some tests may rely on mocks persisting across test files. Enabling `restoreMocks: true` may cause these tests to fail. — Will be caught by `npm test`.

---

## Important Design Decisions

1. **Delete vs. archive**: Delete `jest.config.local.js` outright. It's not referenced anywhere and was likely a debugging artifact. If it's needed in the future, it can be recovered from git history.
2. **restoreMocks default**: `restoreMocks: true` is the Jest recommended default. It ensures test isolation. The only reason it was `false` was likely to work around test pollution rather than fix it.

---

## Acceptance Criteria

1. [ ] `backend/jest.config.local.js` is deleted
2. [ ] `backend/jest.config.js` has `restoreMocks: true`
3. [ ] `npm test` passes with all existing tests
4. [ ] `npm run test:integration` passes
5. [ ] No test file references `jest.config.local.js`

---

## Out of Scope

- Restructuring Jest config files
- Adding new Jest configuration options
- Changing test files (only config changes)
- Fixing test pollution in individual tests (covered by enabling restoreMocks)

---

## Security Considerations

- [x] No security impact — this is test configuration only

---

## Testing Checklist

### Backend Tests
- [ ] `npm test` — all unit tests pass with `restoreMocks: true`
- [ ] `npm run test:integration` — integration tests pass
- [ ] Verify no test relies on `jest.config.local.js`

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
