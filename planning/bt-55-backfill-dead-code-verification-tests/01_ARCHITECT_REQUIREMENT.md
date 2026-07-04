# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Frontend
**Priority**: P1
**Effort**: Medium
**Related**: bp-55 (Dead Code Cleanup)

---

## Requirement

bp-55 removed dead code and unused dependencies (axios, root `package-lock.json`, unused npm packages, etc.). However, the cleanup was done manually without automated verification. No tests exist to ensure dependencies are truly unused, that builds succeed after removal, or that `.gitignore` behavior is correct.

This ticket creates automated tests that verify the dead code cleanup from bp-55 is complete and correct.

---

## Existing Infrastructure Audit

### Backend API Check
- [ ] Dependencies removed: axios, unused packages — verify in `backend/package.json`
- [ ] Root `package-lock.json` removed — verify
- [ ] Existing test patterns: `backend/src/__tests__/` — verify

### Frontend API Client Check
- [ ] Cypress axios usage removed — verify in `frontend/cypress/`
- [ ] Heroicons usage in Vue components — verify
- [ ] vue-i18n usage (`$t()`, `useI18n()`) — verify
- [ ] Existing test patterns: `frontend/src/__tests__/` — verify

### Key Insight

This is a **test-only** ticket. All production code changes from bp-55 already exist. The task is to create automated verification tests:
1. Grep scan for removed dependencies (axios, etc.)
2. `npm install` succeeds after dep removal
3. `docker compose up --build` succeeds without root Dockerfile
4. `.gitignore` behavior (root lockfile ignored, subdirectory lockfiles tracked)
5. Cypress dependency verification (no axios in `frontend/cypress/`)
6. Heroicons usage verification in Vue components
7. vue-i18n usage verification (`$t()`, `useI18n()`, `i18n` config)

---

## Scope

### In Scope
- Create `backend/src/__tests__/depRemovalVerification.test.js` — grep scan for removed dependencies
- Create `backend/src/__tests__/npmInstallSucceeds.test.js` — verify `npm install` succeeds
- Create `backend/src/__tests__/dockerBuildSucceeds.test.js` — verify `docker compose up --build` succeeds
- Create `backend/src/__tests__/gitignoreBehavior.test.js` — verify `.gitignore` behavior
- Create `frontend/src/__tests__/cypressDepVerification.test.ts` — verify no axios in Cypress
- Create `frontend/src/__tests__/heroiconsUsage.test.ts` — verify Heroicons usage
- Create `frontend/src/__tests__/vueI18nUsage.test.ts` — verify vue-i18n usage

### Out of Scope
- Modifying any production code from bp-55
- Removing additional dead code
- Changes to `.gitignore` or Dockerfiles (only testing their behavior)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/depRemovalVerification.test.js` | CREATE | Grep scan for removed deps |
| `backend/src/__tests__/npmInstallSucceeds.test.js` | CREATE | Verify npm install succeeds |
| `backend/src/__tests__/dockerBuildSucceeds.test.js` | CREATE | Verify docker build succeeds |
| `backend/src/__tests__/gitignoreBehavior.test.js` | CREATE | Verify .gitignore behavior |
| `frontend/src/__tests__/cypressDepVerification.test.ts` | CREATE | Verify no axios in Cypress |
| `frontend/src/__tests__/heroiconsUsage.test.ts` | CREATE | Verify Heroicons usage |
| `frontend/src/__tests__/vueI18nUsage.test.ts` | CREATE | Verify vue-i18n usage |

---

## Known Unknowns

1. **[Which dependencies were removed]**: Need to check bp-55 implementation to know exactly what to grep for (axios, etc.)
2. **[Dockerfile status]**: Does bp-55 remove the root Dockerfile? Need to verify.
3. **[.gitignore contents]**: What patterns are in `.gitignore`? Need to check.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] Grep scan verifies `axios` is not imported in any production file
2. [ ] `npm install` in `backend/` exits with code 0
3. [ ] `npm install` in `frontend/` exits with code 0
4. [ ] `docker compose up --build` succeeds (or is skipped if Docker not available)
5. [ ] `.gitignore` correctly ignores root `package-lock.json`
6. [ ] `.gitignore` correctly tracks subdirectory lockfiles (e.g., `backend/package-lock.json`)
7. [ ] No `axios` imports found in `frontend/cypress/`
8. [ ] Heroicons are imported correctly in Vue components (verify import path)
9. [ ] vue-i18n is configured correctly (`$t()`, `useI18n()`, `i18n` instance)
10. [ ] `npm test` passes with no regressions
11. [ ] `npm test -- --run` passes for frontend

---

## Testing Checklist

### Backend Tests
- [ ] `backend/src/__tests__/depRemovalVerification.test.js` — CREATED
- [ ] `backend/src/__tests__/npmInstallSucceeds.test.js` — CREATED
- [ ] `backend/src/__tests__/dockerBuildSucceeds.test.js` — CREATED (with skip if Docker unavailable)
- [ ] `backend/src/__tests__/gitignoreBehavior.test.js` — CREATED

### Frontend Tests
- [ ] `frontend/src/__tests__/cypressDepVerification.test.ts` — CREATED
- [ ] `frontend/src/__tests__/heroiconsUsage.test.ts` — CREATED
- [ ] `frontend/src/__tests__/vueI18nUsage.test.ts` — CREATED

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run` — frontend tests pass

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test both positive and negative cases
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-55 behavior
- ❌ **Skipping Docker test** — must verify build succeeds (or explicitly skip with reason)

---

*Fill in all sections before starting implementation.*
