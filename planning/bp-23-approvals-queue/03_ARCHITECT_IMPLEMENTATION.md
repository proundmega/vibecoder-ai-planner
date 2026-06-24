# 03_ARCHITECT_IMPLEMENTATION.md — Approvals Queue

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Medium (~2-3 hours)
**Author**: AI Assistant
**Date created**: 2026-06-24
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-23-approvals-queue

## Implementation Plan

### Phase 1: Create Global Approvals Page

1. **Create `ApprovalsQueue.vue`** — NEW view component:
   - Call `getPendingApprovals()` on mount
   - Render pending approvals list (ticket info, project, requester)
   - Approve/reject buttons per approval
   - Loading state + error state
   - Empty state: "No pending approvals"

### Phase 2: Create Per-Project Approvals Page

2. **Create `ProjectApprovals.vue`** — NEW view component:
   - Call `getPendingApprovals()` on mount
   - Filter approvals by current project
   - Render pending approvals list
   - Approve/reject buttons per approval
   - Loading state + empty state

### Phase 3: Add Routes and Navigation

3. **Add routes** in `frontend/src/router/index.ts`:
   ```typescript
   // Global approvals
   {
     path: '/approvals',
     name: 'ApprovalsQueue',
     component: () => import('../views/ApprovalsQueue.vue'),
     meta: { requiresAuth: true }
   }
   // Per-project approvals
   { path: 'approvals', name: 'ProjectApprovals', component: () => import('../views/ProjectApprovals.vue') }
   ```

4. **Add "Approvals" link to nav bar** — visible to all logged-in users

5. **Add link in ProjectDetail.vue** — "View All Approvals" link in the Tickets tab

### Phase 4: Verify

6. `cd frontend && npm run lint` — zero errors
7. `cd frontend && npm run typecheck` — zero errors
8. `cd frontend && npm test -- --run` — all pass
9. `cd frontend && npm run build` — succeeds

## Rollback Plan

Remove ApprovalsQueue.vue, ProjectApprovals.vue, remove routes, remove nav link, remove link in ProjectDetail.vue. No backend changes.

---

*Ready for implementation.*
