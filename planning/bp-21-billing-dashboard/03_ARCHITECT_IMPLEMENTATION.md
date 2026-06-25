# 03_ARCHITECT_IMPLEMENTATION.md — Billing Dashboard

**Status**: completed
**Priority**: P2 (Medium)
**Effort**: Small (~1-2 hours)
**Author**: AI Assistant
**Date created**: 2026-06-24
**Date completed**: 2026-06-25
**PR**: TBD
**Branch**: bp-21-billing-dashboard

## Implementation Plan

### Phase 1: Create Billing Dashboard View

1. **Create `BillingDashboard.vue`** — NEW view component:
   - Role check on mount (project_admin only, else redirect to /dashboard)
   - Call `getUserBilling()` on mount
   - Render billing summary card
   - Render per-project billing table
   - Loading state + error state
   - Empty state when no billing data

2. **Add route** in `frontend/src/router/index.ts`:
   ```typescript
   {
     path: '/billing',
     name: 'BillingDashboard',
     component: () => import('../views/BillingDashboard.vue'),
     meta: { requiresAuth: true }
   }
   ```

### Phase 2: Add to Navigation

3. **Add billing link to nav bar** — visible only for `project_admin` role:
   - Link to `/billing`
   - Dollar sign or receipt icon

### Phase 3: Verify

4. `cd frontend && npm run lint` — zero errors
5. `cd frontend && npm run typecheck` — zero errors
6. `cd frontend && npm test -- --run` — all pass
7. `cd frontend && npm run build` — succeeds

## Rollback Plan

Remove BillingDashboard.vue, remove route, remove nav link. No backend changes.

---

*Ready for implementation.*
