# 02_ARCHITECT_DESIGN.md — Systematic JS to TypeScript Migration

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The frontend has a mixed JS/TS codebase where only ~30% of files benefit from TypeScript's strict mode. The most critical files (auth store, API client, API modules) are `.js` and bypass type checking entirely. This causes undetected type errors, poor IDE support, and inconsistent use of generated API types.

Additionally, the auth store uses a raw singleton anti-pattern instead of Pinia's `defineStore()`, which breaks devtools, prevents SSR, and forces consumers to use `.value` everywhere.

---

## Current State

### JS Files (no type checking)
```
frontend/src/stores/auth.js        → Singleton Pinia (not defineStore)
frontend/src/api/client.js         → fetch wrapper, no types
frontend/src/api/tickets.js        → 10 API functions, no types
frontend/src/api/projects.js       → 6 API functions, no types
frontend/src/api/auth.js           → 4 API functions, no types
frontend/src/api/providers.js      → 8 API functions, no types
frontend/src/api/approvals.js      → 3 API functions, no types
frontend/src/api/memory.js         → 3 API functions, no types
frontend/src/api/github.js         → 4 API functions, no types
frontend/src/api/usage.js          → 3 API functions, no types
frontend/src/api/templates.js      → 3 API functions, no types
frontend/src/api/billing.js        → 3 API functions, no types
frontend/src/api/users.js          → 3 API functions, no types
frontend/src/__tests__/*.test.js   → 16 test files (16/18)
```

### Auth Store (current)
```javascript
// stores/auth.js — singleton anti-pattern
let instance = null
export function useAuthStore() {
  if (instance) return instance
  const user = ref(null)
  const token = ref('')
  // ...
  return instance = { user, token, ... }  // raw refs exposed
}
// Consumers must write: authStore.user.value.name
```

### Auth Store (target — defineStore)
```typescript
// stores/auth.ts — proper Pinia store
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref('')
  return { user, token, ... }
})
// Consumers write: authStore.user.name  (auto-unwrapped)
```

### Generated Types (exist but unused by JS modules)
```
frontend/src/api/generated/
  models/
    User.ts, Ticket.ts, Project.ts, Agent.ts, ...
  services/
    TicketsService.ts, ProjectsService.ts, ...
```

The generated types are fully typed but none of the JS API modules import them. Each API function returns `Promise<any>`.

---

## Design

### Option A: Incremental Layer-by-Layer Migration (Recommended)

#### Layer 1: TypeScript Config

Fix `tsconfig.json` first so IDE and `vue-tsc` resolve `@/` aliases correctly.

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

#### Layer 2: API Client

Convert `client.js` → `client.ts` first. This is the foundation for all API modules.

```typescript
// api/client.ts
interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

async function get<T = any>(url: string): Promise<ApiResponse<T>> {
  return apiFetch(url, { method: 'GET' });
}
// post<T>, put<T>, del<T>, patch<T> similarly
```

#### Layer 3: Auth Store

Convert `stores/auth.js` → `stores/auth.ts` with `defineStore()`.

This is the riskiest change because it affects every consumer. Must update:
- `client.ts` (imports store)
- `router/index.ts` (reads localStorage directly — no change needed)
- Every `.vue` file that uses `authStore`

```typescript
// stores/auth.ts
interface User {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'member' | 'project_admin' | 'super_admin';
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(JSON.parse(localStorage.getItem('vibecode_user') || 'null'));
  const token = ref(localStorage.getItem('vibecode_token') || '');
  const permissions = ref<string[]>(JSON.parse(localStorage.getItem('vibecode_permissions') || '[]'));
  const loading = ref(false);
  const error = ref<string | null>(null);

  function setUser(data: User) { ... }
  function setToken(t: string) { ... }
  function logout() { ... }
  async function syncPermissions(role: string) { ... }

  return { user, token, permissions, loading, error, setUser, setToken, logout, syncPermissions };
});
```

#### Layer 4: API Modules (highest traffic first)

Convert each `api/*.js` → `.ts`, importing generated types:

```typescript
// api/tickets.ts
import type { Ticket } from './generated/models/Ticket';
import { get, post, put, del } from './client';

export async function fetchTickets(projectId: number): Promise<ApiResponse<Ticket[]>> {
  return get<Ticket[]>(`/api/v1/tickets?project_id=${projectId}`);
}

export async function createTicket(data: CreateTicketInput): Promise<ApiResponse<Ticket>> {
  return post<Ticket>('/api/v1/tickets', data);
}
```

#### Layer 5: Vue Components (key views)

Add `lang="ts"` to `<script setup>` in key views:
- `Login.vue`, `Dashboard.vue`, `TicketBoard.vue`, `TicketDetail.vue`, `ProjectDetail.vue`

### Option B: Big Bang

Convert all files at once. Risky — if something breaks, hard to debug. Not recommended.

### Option C: Gradual with `.d.ts` declarations

Keep `.js` files but add `.d.ts` declaration files for types. This provides type checking for consumers without changing the implementation. However, it creates a parallel type file for every module, doubling the file count. Not recommended — convert to `.ts` properly.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/tsconfig.json` | MODIFY | Add `baseUrl: "."`, `paths: { "@/*": ["src/*"] }` |
| `frontend/src/api/client.js` | RENAME + CONVERT | `client.ts` with generic `<T>` types |
| `frontend/src/api/client.d.ts` | DELETE | No longer needed (was for JS consumers) |
| `frontend/src/stores/auth.js` | RENAME + CONVERT | `auth.ts` with `defineStore()` |
| `frontend/src/api/tickets.js` | RENAME + CONVERT | `tickets.ts` with generated types |
| `frontend/src/api/projects.js` | RENAME + CONVERT | `projects.ts` with generated types |
| `frontend/src/api/auth.js` | RENAME + CONVERT | `auth.ts` |
| `frontend/src/api/providers.js` | RENAME + CONVERT | `providers.ts` |
| `frontend/src/api/approvals.js` | RENAME + CONVERT | `approvals.ts` |
| `frontend/src/api/memory.js` | RENAME + CONVERT | `memory.ts` |
| `frontend/src/api/github.js` | RENAME + CONVERT | `github.ts` |
| `frontend/src/api/usage.js` | RENAME + CONVERT | `usage.ts` |
| `frontend/src/api/templates.js` | RENAME + CONVERT | `templates.ts` |
| `frontend/src/api/billing.js` | RENAME + CONVERT | `billing.ts` |
| `frontend/src/api/users.js` | RENAME + CONVERT | `users.ts` |
| `frontend/src/views/Login.vue` | MODIFY | Add `lang="ts"` to script setup |
| `frontend/src/views/Dashboard.vue` | MODIFY | Add `lang="ts"` to script setup |
| `frontend/src/views/TicketBoard.vue` | MODIFY | Add `lang="ts"` to script setup |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Add `lang="ts"` to script setup |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add `lang="ts"` to script setup |
| All `.vue` files using authStore | MODIFY | Remove `.value` from store access |
| `frontend/src/router/index.ts` | MODIFY | Fix any type errors from store changes |
| `frontend/src/__tests__/*.test.js` | MODIFY | Update imports from `.js` → no extension |
| `frontend/src/api/generated/` | REGENERATE | If any types are missing |

---

## Data Flow After Migration

```
TypeScript Layer:
  stores/auth.ts    → typed User, typed refs (auto-unwrapped)
  api/client.ts     → get<T>, post<T>, etc. (typed responses)
  api/tickets.ts    → fetchTickets(): Promise<ApiResponse<Ticket[]>>
  api/projects.ts   → fetchProjects(): Promise<ApiResponse<Project[]>>
  views/*.vue       → <script setup lang="ts"> typed store access

Generated Types Layer:
  api/generated/models/*.ts   → User, Ticket, Project, etc.
  api/generated/services/*.ts → (optional — may use custom API modules instead)
```

---

## Dependencies

- No new npm dependencies
- No config changes beyond `tsconfig.json`

---

## Config / Environment Changes

- `tsconfig.json`: Add `baseUrl` and `paths`

---

## Security Considerations

- No security impact — type-only changes
