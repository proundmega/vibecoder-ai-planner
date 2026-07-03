# 03_ARCHITECT_IMPLEMENTATION.md — Systematic JS to TypeScript Migration

**Status**: planned
**Priority**: P3
**Effort**: Large
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Frontend

**Dependencies**: None (but should be done after bp-54 Error Handling to avoid double work on `client.js`)

---

### a) Purpose

Migrate the frontend from ~30% TypeScript coverage to ~90% by converting all stores, API modules, and key Vue components to TypeScript, and fix the auth store to use `defineStore()` properly.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order (each layer depends on the previous):

**Phase 1: Foundation**

1. **Fix `tsconfig.json`** — `frontend/tsconfig.json`
   - Add `"baseUrl": "."` and `"paths": { "@/*": ["src/*"] }`
   - Verify IDE and `vue-tsc` resolve `@/` imports
   - *Depends on*: nothing

**Phase 2: API Client (foundation for all API modules)**

2. **Convert `client.js` → `client.ts`** — `frontend/src/api/client.ts`
   - Add generic `<T>` to `get`, `post`, `put`, `del`, `patch` functions
   - Define `ApiResponse<T>` interface
   - Export typed function signatures
   - *Depends on*: nothing (but coordinate with bp-54 if that changes return shape)
   - **Delete**: `client.d.ts` (no longer needed)

**Phase 3: Auth Store (foundation for views)**

3. **Convert `auth.js` → `auth.ts` using `defineStore()`** — `frontend/src/stores/auth.ts`
   - Define `User` and `Permission` types
   - Use `defineStore('auth', () => { ... })` pattern (Composition API store)
   - Refactor from raw singleton to proper Pinia store
   - Ensure auto-unwrapping works (no `.value` in consumers)
   - *Depends on*: nothing

**Phase 4: API Modules (one by one, highest traffic first)**

4. **Convert `tickets.js` → `tickets.ts`** — `frontend/src/api/tickets.ts`
   - Import `Ticket` from generated types
   - Type all function parameters and return values with `ApiResponse<Ticket>`
   - *Depends on*: Phase 2

5. **Convert `projects.js` → `projects.ts`** — `frontend/src/api/projects.ts`
   - Similar pattern to tickets
   - *Depends on*: Phase 2

6. **Convert `auth.js` → `auth.ts`** — `frontend/src/api/auth.ts`
   - Login/register response types
   - *Depends on*: Phase 2, Phase 3

7. **Convert remaining API modules** — `providers.ts`, `approvals.ts`, `memory.ts`, `github.ts`, `usage.ts`, `templates.ts`, `billing.ts`, `users.ts`
   - Each follows the same pattern: `.js` → `.ts`, add types, import generated types
   - *Depends on*: Phase 2

**Phase 5: Vue Components (key views)**

8. **Update `router/index.ts`** — fix any type errors caused by store changes
   - Router reads localStorage directly (no store dependency) — verify no changes needed
   - *Depends on*: Phase 3

9. **Update views using authStore** — all `.vue` files
   - Remove `.value` from `authStore.user.value` → `authStore.user`
   - Remove `.value` from `authStore.token.value` → `authStore.token`
   - Remove `.value` from `authStore.permissions.value` → `authStore.permissions`
   - *Depends on*: Phase 3

10. **Convert `Login.vue`** — `frontend/src/views/Login.vue`
    - Add `lang="ts"` to `<script setup>`
    - Type form refs, computed, event handlers
    - *Depends on*: Phase 4

11. **Convert `Dashboard.vue`** — `frontend/src/views/Dashboard.vue`
    - Add `lang="ts"` to `<script setup>`
    - *Depends on*: Phase 4

12. **Convert `TicketBoard.vue`** — `frontend/src/views/TicketBoard.vue`
    - Add `lang="ts"` to `<script setup>`
    - Type drag-and-drop, column definitions, ticket data
    - *Depends on*: Phase 4

13. **Convert `TicketDetail.vue`** — `frontend/src/views/TicketDetail.vue`
    - Add `lang="ts"` to `<script setup>`
    - Type ticket, comment, attachment data
    - *Depends on*: Phase 4

14. **Convert `ProjectDetail.vue`** — `frontend/src/views/ProjectDetail.vue`
    - Add `lang="ts"` to `<script setup>`
    - Type project, tab state, all feature data
    - *Depends on*: Phase 4

**Phase 6: Test Updates**

15. **Update test imports** — `frontend/src/__tests__/*.test.js`
    - Change imports from `'../api/tickets'` to `'../api/tickets'` (no extension needed — vitest resolves both)
    - Fix any type discrepancies if test data shapes don't match types
    - *Depends on*: Phase 4

**Phase 7: Final Verification**

16. **Run full verification** — typecheck + tests + build + lint
    - `npm run typecheck` — must pass with zero errors
    - `npm test -- --run` — must pass
    - `npm run build` — must succeed
    - `npm run lint` — must pass
    - *Depends on*: Phases 1-6

---

### c) Per-File Action Plan

#### `frontend/tsconfig.json` (MODIFY)
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

#### `frontend/src/api/client.ts` (RENAME + CONVERT from `client.js`)
```typescript
export interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

export async function get<T = any>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  return apiFetch<T>(url, { method: 'GET', ...options });
}

export async function post<T = any>(url: string, body?: unknown): Promise<ApiResponse<T>> {
  return apiFetch<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}
// ... put<T>, del<T>, patch<T> follow same pattern
```

#### `frontend/src/stores/auth.ts` (RENAME + CONVERT from `auth.js`)
```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'member' | 'project_admin' | 'super_admin';
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(loadFromStorage<User>('vibecode_user'));
  const token = ref(localStorage.getItem('vibecode_token') || '');
  const permissions = ref<string[]>(loadFromStorage<string[]>('vibecode_permissions') || []);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function setUser(data: User) {
    user.value = data;
    localStorage.setItem('vibecode_user', JSON.stringify(data));
  }

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem('vibecode_token', t);
  }

  function logout() {
    user.value = null;
    token.value = '';
    permissions.value = [];
    localStorage.removeItem('vibecode_token');
    localStorage.removeItem('vibecode_user');
    localStorage.removeItem('vibecode_permissions');
  }

  // ... remaining methods

  return { user, token, permissions, loading, error, setUser, setToken, logout };
});

function loadFromStorage<T>(key: string): T | null {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}
```

#### Consumer change pattern (every `.vue` file):
```diff
- const authStore = useAuthStore()
- const userName = authStore.user.value?.name
+ const authStore = useAuthStore()
+ const userName = authStore.user?.name
```

---

### d) Dependencies

- No new npm dependencies
- Generated types in `api/generated/` should be up-to-date

---

### e) Risks/Edge Cases

- **[Breaking import paths]**: After renaming `.js` to `.ts`, all imports in consumer files must be updated. Vitest resolves imports without extensions, so `'../api/tickets'` works for both `.js` and `.ts`.
- **[Store ref unbinding]**: Components that destructure from authStore must continue to use Pinia's `storeToRefs()` for individual refs. Ensure no `const { user } = authStore` without `storeToRefs`.
- **[Test type mismatches]**: If test data shapes don't match the new types, the runtime tests still pass (JS tests don't typecheck). But the test data should be fixed to match types for accuracy.

---

### f) Testing

#### Verification
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test -- --run` — all tests pass
- [ ] `npm run build` — succeeds
- [ ] `npm run lint` — no lint errors

#### Manual Verification
- [ ] Login/register flow works end-to-end
- [ ] Dashboard loads with user data
- [ ] Ticket board loads and allows drag-and-drop
- [ ] Ticket detail loads with comments and attachments
- [ ] Auth store token is correctly read/written to localStorage

---

### g) Migration Notes

No database migrations. No backend changes.

---

### h) Files Changed

**Renamed + Converted (`.js` → `.ts`):**
```
frontend/src/api/client.js     → frontend/src/api/client.ts
frontend/src/stores/auth.js     → frontend/src/stores/auth.ts
frontend/src/api/tickets.js     → frontend/src/api/tickets.ts
frontend/src/api/projects.js    → frontend/src/api/projects.ts
frontend/src/api/auth.js        → frontend/src/api/auth.ts
frontend/src/api/providers.js   → frontend/src/api/providers.ts
frontend/src/api/approvals.js   → frontend/src/api/approvals.ts
frontend/src/api/memory.js      → frontend/src/api/memory.ts
frontend/src/api/github.js      → frontend/src/api/github.ts
frontend/src/api/usage.js       → frontend/src/api/usage.ts
frontend/src/api/templates.js   → frontend/src/api/templates.ts
frontend/src/api/billing.js     → frontend/src/api/billing.ts
frontend/src/api/users.js       → frontend/src/api/users.ts
```

**Deleted:**
```
frontend/src/api/client.d.ts    → DELETE (replaced by client.ts)
```

**Modified:**
```
frontend/tsconfig.json          → MODIFY (baseUrl, paths)
frontend/src/router/index.ts    → MODIFY (type fixes from store changes)
frontend/src/views/Login.vue    → MODIFY (lang="ts")
frontend/src/views/Dashboard.vue → MODIFY (lang="ts")
frontend/src/views/TicketBoard.vue → MODIFY (lang="ts")
frontend/src/views/TicketDetail.vue → MODIFY (lang="ts")
frontend/src/views/ProjectDetail.vue → MODIFY (lang="ts")
frontend/src/views/*.vue        → MODIFY (remove .value from authStore)
frontend/src/components/*.vue   → MODIFY (remove .value from authStore)
frontend/src/__tests__/*.test.js → MODIFY (import resolution)
```

---

### i) Code Review Checklist

- [ ] `defineStore('auth')` used — removes singleton anti-pattern
- [ ] `.value` completely removed from authStore access in all `.vue` files
- [ ] No `.js` files remain in `frontend/src/api/` or `frontend/src/stores/`
- [ ] `client.d.ts` deleted — types now live in `client.ts`
- [ ] `ApiResponse<T>` generic is used correctly throughout
- [ ] Generated types are imported and used (not redefined)
- [ ] `storeToRefs()` used for destructuring where needed
- [ ] `npm run typecheck` passes with zero errors
- [ ] All imports resolve correctly (no missing `.js` → `.ts` import resolution)
- [ ] `npm run build` produces the same bundle

---

### j) Post-Deploy Verification

1. [ ] `npm run typecheck` — zero errors
2. [ ] `npm test -- --run` — passes
3. [ ] `npm run build` — succeeds
4. [ ] `npm run lint` — passes
5. [ ] Login page renders and authenticates correctly
6. [ ] Dashboard shows user info correctly
7. [ ] Ticket board loads tickets and allows status changes
8. [ ] Ticket detail loads comments and attachments
9. [ ] Project detail tabs all load correctly
10. [ ] Auth store state persists across page refreshes (localStorage)
