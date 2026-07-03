# 00_ARCHITECT_CHECKLIST.md — Approvals Queue

**Status**: completed
**Date created**: 2026-06-24

## Pre-Implementation Checklist

### Existing Infrastructure Audit
- [x] Approval API endpoints exist in `backend/src/api/approvals.js`:
  - `GET /` — list all approvals (requires `APPROVAL_VIEW` — super_admin only)
  - `GET /pending` — list pending approvals (no permission check — open)
  - `GET /ticket/:ticketId` — list approvals for a ticket
  - `POST /:id/approve` — approve (requires `APPROVAL_APPROVE`)
  - `POST /:id/reject` — reject (requires `APPROVAL_REJECT`)
  - `POST /` — create approval request
- [x] ApprovalService has `getPendingByRequester()`, `getByTicketId()`, `getAll()`
- [x] TicketDetail.vue uses `getTicketApprovals()` and `createApproval()` (used)
- [x] `getPendingApprovals()`, `approveRequest()`, `rejectRequest()` exist in API client — dead

### Risk Assessment
- Low risk — backend endpoints already exist, only frontend changes
- No database changes needed
- Two pages: global (all projects) + per-project

### Files to Touch
**Frontend**:
1. `frontend/src/views/ApprovalsQueue.vue` — NEW view (global approvals)
2. `frontend/src/views/ProjectApprovals.vue` — NEW view (per-project approvals)
3. `frontend/src/router/index.ts` — add routes
4. `frontend/src/api/approvals.js` — wire up `getPendingApprovals()`, `approveRequest()`, `rejectRequest()` (already exist)
5. `frontend/src/views/ProjectDetail.vue` — add link to per-project approvals

**Tests**:
6. `frontend/src/__tests__/approvals.test.js` — already exists (5 tests)

### Validation Steps
- [ ] `cd frontend && npm run lint` — zero errors
- [ ] `cd frontend && npm run typecheck` — zero errors
- [ ] `cd frontend && npm test -- --run` — all pass
- [ ] `cd frontend && npm run build` — succeeds

### Rollback
Revert new files and route changes. No backend changes.

---

*Ready for requirement phase.*
