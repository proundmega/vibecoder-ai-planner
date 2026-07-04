# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Medium
**Related**: bp-57 (Migrate to TypeScript)

---

## Requirement

bp-57 migrated frontend code to TypeScript, including the auth Pinia store, typed API client, `tsconfig.json` path aliases, and Vue components with `lang="ts"`. However, none of these TypeScript-specific changes have corresponding tests. Without tests, store behavior, typed API client functions, path alias resolution, and TypeScript compilation cannot be verified.

This ticket backfills all missing test coverage for the bp-57 TypeScript migration changes.

---

## Existing Infrastructure Audit

### Frontend API Client Check
- [ ] Auth store exists: `frontend/src/stores/auth.ts` — verify (was `auth.js`)
- [ ] Typed API client exists: `frontend/src/api/client.ts` — verify (was `client.js`)
- [ ] Generated types exist: `frontend/src/api/generated/` — verify
- [ ] `tsconfig.json` path aliases: `@/` → `src/` — verify
- [ ] Existing test patterns: `frontend/src/__tests__/` — verify

### Key Insight

This is a **frontend test-only** ticket. All TypeScript migration from bp-57 already exists. The task is to create tests for:
1. `defineStore()` auth store (setUser, setToken, logout, syncPermissions)
2. Typed API client functions (`get<T>`, `post<T>`, etc.)
3. Generated types are actually imported and used
4. `tsconfig.json` path alias resolution (`@/` in IDE and `vue-tsc`)
5. Vue components with `lang="ts"` compile correctly
6. Store auto-unwrapping (`.value` no longer needed in consumers)
7. Backward compatibility — `.js` test files resolve `.ts` module imports

---

## Scope

### In Scope
- Create `frontend/src/__tests__/authStore.test.ts` — test defineStore() auth store
- Create `frontend/src/__tests__/typedApiClient.test.ts` — test typed API client functions
- Create `frontend/src/__tests__/generatedTypesImport.test.ts` — verify generated types are imported
- Create `frontend/src/__tests__/pathAliasResolution.test.ts` — test @/ path alias
- Create `frontend/src/__tests__/langTsCompile.test.ts` — test lang="ts" components compile
- Create `frontend/src/__tests__/storeAutoUnwrap.test.ts` — test store auto-unwrapping
- Create `frontend/src/__tests__/backwardCompat.test.ts` — test .js → .ts module resolution

### Out of Scope
- Modifying any production code from bp-57
- Creating additional TypeScript migrations
- Changes to tsconfig.json or build configuration

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/__tests__/authStore.test.ts` | CREATE | Test defineStore() auth store |
| `frontend/src/__tests__/typedApiClient.test.ts` | CREATE | Test typed API client |
| `frontend/src/__tests__/generatedTypesImport.test.ts` | CREATE | Verify generated types imported |
| `frontend/src/__tests__/pathAliasResolution.test.ts` | CREATE | Test @/ path alias |
| `frontend/src/__tests__/langTsCompile.test.ts` | CREATE | Test lang="ts" compilation |
| `frontend/src/__tests__/storeAutoUnwrap.test.ts` | CREATE | Test store auto-unwrapping |
| `frontend/src/__tests__/backwardCompat.test.ts` | CREATE | Test .js → .ts resolution |

---

## Known Unknowns

1. **[Auth store methods]**: Exact method names in `frontend/src/stores/auth.ts`. Need to check.
2. **[Typed API client functions]**: Exact function signatures in `frontend/src/api/client.ts`. Need to check.
3. **[Generated types]**: Which types are generated? Need to check `frontend/src/api/generated/`.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] Auth store `setUser` sets user in store and localStorage
2. [ ] Auth store `setToken` sets token in store and localStorage
3. [ ] Auth store `logout` clears all auth state
4. [ ] Auth store `syncPermissions` reads permissions from localStorage
5. [ ] Typed `get<T>` returns typed response
6. [ ] Typed `post<T>` returns typed response
7. [ ] Generated types are imported in converted API modules
8. [ ] `@/` path alias resolves correctly in tests
9. [ ] Vue components with `lang="ts"` compile without errors
10. [ ] Store state is auto-unwrapped (no `.value` needed in consumers)
11. [ ] `.js` test files can import `.ts` modules
12. [ ] `npm run typecheck` passes
13. [ ] `npm test -- --run` passes

---

## Testing Checklist

### Frontend Tests
- [ ] `frontend/src/__tests__/authStore.test.ts` — CREATED
- [ ] `frontend/src/__tests__/typedApiClient.test.ts` — CREATED
- [ ] `frontend/src/__tests__/generatedTypesImport.test.ts` — CREATED
- [ ] `frontend/src/__tests__/pathAliasResolution.test.ts` — CREATED
- [ ] `frontend/src/__tests__/langTsCompile.test.ts` — CREATED
- [ ] `frontend/src/__tests__/storeAutoUnwrap.test.ts` — CREATED
- [ ] `frontend/src/__tests__/backwardCompat.test.ts` — CREATED

### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run` — frontend tests pass

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test error cases, edge cases
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-57 behavior
- ❌ **Skipping typecheck** — TypeScript migration must be verified with `vue-tsc`

---

*Fill in all sections before starting implementation.*
