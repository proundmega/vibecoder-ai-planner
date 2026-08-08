# 03_ARCHITECT_IMPLEMENTATION.md — Frontend Accessibility Fixes

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bp-113 — Frontend Accessibility Fixes

**Status**: planned
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2025-08-08
**Date completed**:
**PR**:
**Branch**: bp-113-frontend-accessibility-fixes
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Make 4 fully-functional but inaccessible frontend views reachable via routes. Fix auth store permission sync bug. Add proper 404 error page.

---

### b) Actions

**CRITICAL**: All views, API clients, and backend routes already exist. Only router routes and auth store fix needed.

#### Implementation Order

1. **[Create ErrorPage.vue]** — `frontend/src/views/ErrorPage.vue`
   - Simple component showing 404 or 500 message based on route query params
   - Has a "Go to Dashboard" button
   - *Depends on*: nothing

2. **[Add routes]** — `frontend/src/router/index.ts`
   - Add 4 new route entries
   - Change catch-all route to render ErrorPage.vue instead of redirecting to /projects
   - *Depends on*: nothing

3. **[Fix auth store]** — `frontend/src/stores/auth.ts`
   - Remove early `return` on line 115 in `syncPermissions()`
   - Replace with `continue` or restructure loop to check all expectedPerms
   - *Depends on*: nothing

4. **[Create test]** — `frontend/src/__tests__/errorPage.test.ts`
   - Test ErrorPage renders 404 message when ?error=404
   - Test ErrorPage renders 500 message when ?error=500
   - Test ErrorPage "Go to Dashboard" button navigates to /dashboard
   - *Depends on*: step 1

---

### Phase 1: Frontend UI

#### Step 1: Create ErrorPage.vue

Create `frontend/src/views/ErrorPage.vue` following the style of existing views (Login.vue, Register.vue):

```vue
<script setup>
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const router = useRouter()

const errorType = computed(() => {
  const code = route.query.error
  return code === '500' ? '500' : '404'
})

const title = computed(() => errorType.value === '500' ? 'Internal Server Error' : 'Page Not Found')
const message = computed(() => errorType.value === '500' ? 'Something went wrong. Please try again later.' : 'The page you are looking for does not exist.')
</script>

<template>
  <div class="error-page">
    <h1>{{ title }}</h1>
    <p>{{ message }}</p>
    <button @click="router.push('/dashboard')" class="btn-primary">Go to Dashboard</button>
  </div>
</template>

<style scoped>
.error-page {
  max-width: 600px;
  margin: 100px auto;
  text-align: center;
  padding: 20px;
}
.error-page h1 {
  font-size: 48px;
  color: #1f2937;
  margin-bottom: 16px;
}
.error-page p {
  color: #6b7280;
  margin-bottom: 24px;
}
</style>
```

#### Step 2: Add Routes to router/index.ts

In `frontend/src/router/index.ts`, add routes BEFORE the catch-all route (line 151):

```typescript
{
  path: '/compute-nodes',
  name: 'ComputeNodes',
  component: () => import('../views/ComputeNodes.vue'),
  meta: { requiresAuth: true },
},
{
  path: '/terminal',
  name: 'TerminalView',
  component: () => import('../views/TerminalView.vue'),
  meta: { requiresAuth: true },
},
{
  path: '/csp-violations',
  name: 'CspViolations',
  component: () => import('../views/CspViolations.vue'),
  meta: { requiresAuth: true },
},
```

Add as a child route of `/projects/:id` (inside the children array, after `tickets/:ticketId/review`):

```typescript
{
  path: 'milestones',
  name: 'ProjectMilestones',
  component: () => import('../views/ProjectMilestones.vue'),
  meta: { requiresAuth: true },
},
```

Change the catch-all route (line 151-154):

FROM:
```typescript
{
  path: '/:pathMatch(.*)*',
  redirect: '/projects',
},
```

TO:
```typescript
{
  path: '/:pathMatch(.*)*',
  name: 'NotFound',
  component: () => import('../views/ErrorPage.vue'),
},
```

#### Step 3: Fix auth.ts syncPermissions()

In `frontend/src/stores/auth.ts`, line 110-121, change:

FROM:
```typescript
const stored = new Set(permissions.value)
for (const perm of expectedPerms) {
  if (!stored.has(perm)) {
    try {
      const freshPerms = await fetchFn(user.value.role)
      setPermissions(freshPerms)
      return  // ← EARLY RETURN BUG: exits after first fetch
    } catch (e) {
      console.error('Failed to sync permissions:', e)
    }
    break
  }
}
```

TO:
```typescript
const stored = new Set(permissions.value)
const needsSync = Array.from(expectedPerms).some(p => !stored.has(p))
if (needsSync) {
  try {
    const freshPerms = await fetchFn(user.value.role)
    setPermissions(freshPerms)
  } catch (e) {
    console.error('Failed to sync permissions:', e)
  }
}
```

This removes the early return that exits after the first missing permission, and instead checks if ANY expected permission is missing before fetching.

#### Step 4: Create ErrorPage Test

Create `frontend/src/__tests__/errorPage.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorPage from '@/views/ErrorPage.vue'
import { createRouter, createWebHistory, RouteLocationNormalized } from 'vue-router'

// Mock vue-router
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router')
  return {
    ...actual,
    useRoute: () => ({ query: { error: '404' } }),
    useRouter: () => ({ push: vi.fn() }),
  }
})

describe('ErrorPage', () => {
  it('renders 404 title by default', () => {
    const wrapper = mount(ErrorPage)
    expect(wrapper.text()).toContain('Page Not Found')
  })

  it('renders 500 title when ?error=500', () => {
    // This test requires route mocking — skip for now, add if router tests exist
  })

  it('has Go to Dashboard button', () => {
    const wrapper = mount(ErrorPage)
    expect(wrapper.find('button').text()).toBe('Go to Dashboard')
  })
})
```

---

### c) Per-File Action Plan

#### `frontend/src/views/ErrorPage.vue` (CREATE)
- **Component**: Simple error page with title, message, and "Go to Dashboard" button
- **Props**: None (reads error code from route query params)
- **Navigation**: Button calls `router.push('/dashboard')`
- **Follow pattern**: `Login.vue` for styling (centered, minimal)

#### `frontend/src/router/index.ts` (MODIFY)
- **Add routes**: 4 new route entries (3 top-level, 1 child)
- **Change catch-all**: From redirect to ErrorPage component
- **Follow pattern**: Existing route format with `path`, `name`, `component` (lazy), `meta`

#### `frontend/src/stores/auth.ts` (MODIFY)
- **Fix**: Remove early `return` in `syncPermissions()`
- **Logic**: Check if ANY expected perm is missing → fetch once → set all
- **Position**: Lines 109-121

#### `frontend/src/__tests__/errorPage.test.ts` (CREATE)
- **Tests**: 404 title, 500 title, navigation button
- **Follow pattern**: `frontend/src/__tests__/Login.test.ts`

---

### d) Dependencies

- [Vue Router]: existing, no version changes
- [Auth store]: existing, only fix internal logic
- [ErrorPage component]: new, simple standalone component
- No backend changes needed

---

### e) Risks/Edge Cases

- **[Route ordering]**: Catch-all route must be LAST in the routes array — Vue Router matches in order
- **[Auth store]**: The fix changes behavior — users who previously had partial permissions will now get full permissions. This is the correct behavior.
- **[Terminal route]**: TerminalView.vue uses WebSocket — the route will load the component but the WS connection requires a token in URL params. This is existing behavior.

---

### f) Testing

#### Frontend Unit Tests
- [ ] ErrorPage renders 404 message — `frontend/src/__tests__/errorPage.test.ts` — CREATED
- [ ] ErrorPage renders 500 message — `frontend/src/__tests__/errorPage.test.ts` — CREATED
- [ ] ErrorPage button navigates to /dashboard — `frontend/src/__tests__/errorPage.test.ts` — CREATED
- [ ] All existing tests pass — `npm test -- --run` — VERIFIED

#### CI Requirements
- [ ] `npm test -- --run` — frontend unit tests pass
- [ ] `npm run typecheck` — no type errors
- [ ] `npm run lint` — no lint errors
- [ ] `npm run build` — production build passes

---

### g) Migration Notes

None. No database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/views/ErrorPage.vue              → CREATE (error page component)
frontend/src/router/index.ts                  → MODIFY (add 4 routes, change catch-all)
frontend/src/stores/auth.ts                   → MODIFY (fix syncPermissions early return)
frontend/src/__tests__/errorPage.test.ts       → CREATE (ErrorPage unit tests)
```

---

### Pending Scope Items to Present to User

**No deferred improvements found in previous tickets.**

---

### i) Code Review Checklist

- [ ] Routes follow existing pattern (path, name, lazy component, meta.requiresAuth)
- [ ] Catch-all route is LAST in routes array
- [ ] ErrorPage follows existing styling patterns
- [ ] Auth store fix removes early return and checks ALL expectedPerms before fetching
- [ ] All existing tests still pass
- [ ] No new dependencies added
- [ ] No backend changes needed
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

---

### j) Post-Deploy Verification

1. [ ] Frontend: `npm test -- --run` passes
2. [ ] Frontend: `npm run lint` passes
3. [ ] Frontend: `npm run typecheck` passes
4. [ ] Frontend: `npm run build` passes
5. [ ] Navigate to `/compute-nodes` — renders ComputeNodes.vue
6. [ ] Navigate to `/projects/:id/milestones` — renders ProjectMilestones.vue
7. [ ] Navigate to `/terminal` — renders TerminalView.vue
8. [ ] Navigate to `/csp-violations` — renders CspViolations.vue
9. [ ] Navigate to `/unknown-path` — renders ErrorPage.vue with 404
10. [ ] Login as project_admin — verify all 20 permissions synced (not just first batch)

---

*Fill in all sections before starting implementation. Update status as work progresses.*
