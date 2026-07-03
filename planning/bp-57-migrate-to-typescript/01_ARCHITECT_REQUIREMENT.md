# 01_ARCHITECT_REQUIREMENT.md — Systematic JS to TypeScript Migration

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P3
**Effort**: Large

---

## Requirement

Systematically migrate JavaScript files in the frontend to TypeScript to increase type safety coverage from ~30% to ~90% of the codebase. Currently, stores, API clients, most API modules, and test files are `.js` while the router, some API modules, and composables are `.ts`. This mixed approach means `strict: true` in `tsconfig.json` only protects a minority of files.

**Problem**: TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `strict: true`) is enabled in `tsconfig.json` but only applies to `.ts` and `.vue` files. The majority of the codebase (stores, API modules, tests) is `.js` and bypasses type checking entirely. This leads to:
- Undetected type errors in API calls
- Missing null/undefined checks
- Poor IDE autocomplete for stores and API responses
- `any` types proliferating where generated types exist but aren't used

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Files to Migrate

| Current Path | Type | Priority |
|-------------|------|----------|
| `frontend/src/stores/auth.js` | Pinia store (singleton, not defineStore) | HIGH — most imported module |
| `frontend/src/api/client.js` | API fetch wrapper | HIGH — used by all API modules |
| `frontend/src/api/tickets.js` | API module | HIGH |
| `frontend/src/api/projects.js` | API module | HIGH |
| `frontend/src/api/auth.js` | API module | HIGH |
| `frontend/src/api/providers.js` | API module | MEDIUM |
| `frontend/src/api/approvals.js` | API module | MEDIUM |
| `frontend/src/api/memory.js` | API module | MEDIUM |
| `frontend/src/api/github.js` | API module | MEDIUM |
| `frontend/src/api/usage.js` | API module | MEDIUM |
| `frontend/src/api/templates.js` | API module | LOW |
| `frontend/src/api/billing.js` | API module | LOW |
| `frontend/src/api/users.js` | API module | LOW |
| `frontend/src/__tests__/*.test.js` (16 files) | Test files | LOW — test JS is acceptable |
| `frontend/src/components/*.vue` (most use `<script setup>` without `lang="ts"`) | Vue components | MEDIUM |

### Existing TypeScript Coverage

| Area | Files | TypeScript? | Coverage |
|------|-------|-------------|----------|
| Router | `router/index.ts` | ✅ Yes | Good |
| Composables | `composables/*.ts` | ✅ Yes | Good |
| API modules (partial) | `milestones.ts`, `computeNodes.ts`, `credentials.ts`, `deployments.ts` | ✅ Yes | Good |
| Generated types | `api/generated/` | ✅ Yes | Good |
| API client | `api/client.js` | ❌ No | None |
| Core store | `stores/auth.js` | ❌ No | None |
| API modules (most) | `api/*.js` (10 files) | ❌ No | None |
| Views | `views/*.vue` | ❌ Mostly `<script>` not `<script lang="ts">` | None |
| Components | `components/*.vue` | ❌ Mostly `<script>` not `<script lang="ts">` | None |
| Tests | `__tests__/*.test.js` (16/18) | ❌ No | None |

### Missing Config

- `tsconfig.json` has no `baseUrl` or `paths` for `@` alias — while Vite resolves `@/` at build time, TypeScript IDE support doesn't know about it

### Key Insight
This is FRONTEND-ONLY. Backend remains CommonJS JavaScript (as documented in AGENTS.md). The migration should be incremental — convert one layer at a time, with generated types providing the foundation.

---

## Scope

### In Scope
- Convert `frontend/src/api/client.js` to TypeScript with full typing
- Convert `frontend/src/stores/auth.js` to TypeScript (and fix the singleton antipattern by using `defineStore`)
- Convert `frontend/src/api/tickets.js`, `projects.js`, `auth.js`, `providers.js`, `approvals.js`, `memory.js`, `github.js`, `usage.js` to TypeScript
- Add proper types using existing generated types from `api/generated/`
- Fix `tsconfig.json` — add `baseUrl` and `paths` for `@` alias
- Convert key Vue components (`Login.vue`, `Dashboard.vue`, `TicketBoard.vue`) to `<script setup lang="ts">`
- Update `client.d.ts` to match the actual client exports

### Out of Scope
- Converting backend JS files (backend is CommonJS — this is by design per AGENTS.md)
- Converting test files to TypeScript (test JS is acceptable; vitest handles both)
- Converting every single `.vue` file — start with the most-impacted ones
- Converting Cypress test files
- Changing any runtime behavior — conversion only
- Adding new API endpoints or features

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/api/client.ts` | RENAME + CONVERT | `.js` → `.ts`; add type exports |
| `frontend/src/stores/auth.ts` | RENAME + CONVERT | `.js` → `.ts`; refactor to `defineStore()` |
| `frontend/src/api/tickets.ts` | RENAME + CONVERT | `.js` → `.ts`; use generated types |
| `frontend/src/api/projects.ts` | RENAME + CONVERT | `.js` → `.ts`; use generated types |
| `frontend/src/api/auth.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/providers.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/approvals.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/memory.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/github.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/usage.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/templates.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/billing.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/users.ts` | RENAME + CONVERT | `.js` → `.ts` |
| `frontend/src/api/client.d.ts` | UPDATE | Remove (no longer needed with `.ts`) |
| `frontend/src/views/Login.vue` | MODIFY | Add `lang="ts"` to `<script setup>` |
| `frontend/src/views/Dashboard.vue` | MODIFY | Add `lang="ts"` to `<script setup>` |
| `frontend/src/views/TicketBoard.vue` | MODIFY | Add `lang="ts"` to `<script setup>` |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add `lang="ts"` to `<script setup>` |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Add `lang="ts"` to `<script setup>` |
| `frontend/tsconfig.json` | MODIFY | Add `baseUrl`, `paths` for `@` |
| `frontend/src/router/index.ts` | MODIFY | Fix any type issues exposed by store migration |
| `database` | NONE | No DB changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Generated type coverage]**: Do the generated types in `api/generated/` cover all API endpoints used? Need to audit endpoint usage vs. generated types.
2. **[Store consumer impact]**: Converting `auth.js` to `defineStore()` changes how consumers access the store (`.value` is no longer needed). Every `.vue` file and `client.js` that accesses the store needs updating.
3. **[Test compatibility]**: Test files are `.js` and import from `.js` modules. After renaming to `.ts`, test imports need updating to `.ts` (or no extension — vitest resolves both).

---

## Important Design Decisions

1. **Auth store**: Convert from raw singleton to proper `defineStore('auth', ...)`. This fixes the `.value` anti-pattern and restores Pinia devtools support. All consumers will need updating, but this is a one-time change that's worth it.
2. **File rename strategy**: Rename `.js` → `.ts` in-place. Do not move files. Do not create parallel copies. Update imports in all consumers at the same time.
3. **Vue component conversion**: Add `lang="ts"` to `<script setup>` blocks incrementally. No need to convert all at once — convert the most-impacted views first.
4. **Backend is out of scope**: Backend uses CommonJS and will stay JavaScript. This is intentional.

---

## Acceptance Criteria

1. [ ] All API modules are `.ts` with typed return values using generated types
2. [ ] `stores/auth.ts` is a proper `defineStore()` with auto-unwrapped refs — no `.value` needed in consumers
3. [ ] `api/client.ts` has typed exports with generic `<T>` support
4. [ ] `tsconfig.json` has `baseUrl` and `paths` for `@` — IDE and `vue-tsc` resolve `@/` correctly
5. [ ] `npm run typecheck` passes with zero errors
6. [ ] `npm test -- --run` passes (test files remain `.js` but import updated `.ts` modules)
7. [ ] `npm run build` succeeds
8. [ ] `npm run lint` passes
9. [ ] No runtime behavior changes — all existing functionality preserved
10. [ ] Auth store consumers use `useAuthStore()` without `.value` throughout

---

## Out of Scope

- Converting backend to TypeScript
- Converting test files to TypeScript
- Converting all `.vue` files (only key views)
- Changing any runtime logic
- Adding new features

---

## Performance Considerations

- TypeScript is compile-time only — no runtime overhead
- Renaming `.js` → `.ts` does not affect bundle size (Vite strips types during build)
- `defineStore()` refactor is runtime-identical to current singleton pattern

---

## Security Considerations

- No security impact — compile-time type checking only
- No new dependencies
- No auth/permission logic changes
