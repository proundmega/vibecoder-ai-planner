# 01_ARCHITECT_REQUIREMENT.md — Approvals Queue

**Status**: planned
**Date created**: 2026-06-24

## Requirement

Create two approval management pages:
1. **Global Approvals Queue** — lists all pending approvals across all projects (super_admin only)
2. **Per-Project Approvals** — lists pending approvals for a specific project (project_admin + member)

## Existing Infrastructure Audit

**What exists**:
- `GET /api/v1/approvals/pending` — lists all pending approvals (no permission check)
- `GET /api/v1/approvals/ticket/:ticketId` — lists approvals for a ticket
- `POST /api/v1/approvals/:id/approve` — approve an approval (requires `APPROVAL_APPROVE`)
- `POST /api/v1/approvals/:id/reject` — reject an approval (requires `APPROVAL_REJECT`)
- ApprovalService has `getPendingByRequester()`, `getByTicketId()`, `getAll()`
- TicketDetail.vue uses `getTicketApprovals()` and `createApproval()`

**What's missing**:
- No global approvals queue page
- No per-project approvals page
- `getPendingApprovals()`, `approveRequest()`, `rejectRequest()` exist in API client but are never imported

## Scope

**In scope**:
1. Global approvals page: `/approvals` — all pending approvals across projects
2. Per-project approvals page: `/projects/:id/approvals` — pending approvals for a project
3. Action buttons: approve/reject on each approval
4. Wire up `getPendingApprovals()`, `approveRequest()`, `rejectRequest()` in API client
5. Add links from ProjectDetail.vue and navigation

**Out of scope**:
- Approval history/completed approvals
- Bulk approve/reject
- Approval notifications
- Approval comments

## Acceptance Criteria

- [ ] Global approvals page at `/approvals` accessible to super_admin
- [ ] Per-project approvals page at `/projects/:id/approvals`
- [ ] Approve/reject buttons work on each approval
- [ ] `getPendingApprovals()`, `approveRequest()`, `rejectRequest()` are wired to API client
- [ ] ProjectDetail.vue has links to per-project approvals
- [ ] All tests pass, lint clean, build succeeds

## Testing Checklist

- [ ] Existing `approvals.test.js` covers all API functions (already done)
- [ ] Lint passes with zero errors
- [ ] Typecheck passes with zero errors
- [ ] All existing tests still pass
- [ ] Build succeeds

## CI Requirements (MANDATORY)

- `cd frontend && npm run lint` — zero errors
- `cd frontend && npm run typecheck` — zero errors
- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run build` — succeeds
