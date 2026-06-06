# RS-8: AI Agent Restrictions

**Status**: planned
**Priority**: P3
**Effort**: Medium
**Dependencies**: RS-3 (Auth middleware — role checks), RS-7 (Ticket Delete — for consistent permission patterns)

---

### a) Purpose

Enforce restrictions on AI agent (`user` role) accounts: no delete, read-only AI tokens, approval required for status transitions to done.

### b) Actions

1. Update backend `backend/src/api/agents.js`:
   - `GET /api/agents` (list agents): `user` role can view but not modify
   - `POST /api/agents/create`: `requireRole('project_admin', 'member')`
   - `DELETE /api/agents/:id`: `requireRole('project_admin')`
   - `POST /api/agents/revoke/:agentId`: `requireRole('project_admin')`
2. Update backend `backend/src/api/tickets.js`:
   - `DELETE /api/tickets/:id`: `requireRole('project_admin', 'member')` — blocks `user` role
   - `PUT /api/tickets/:id`: Allow `user` role only for their own tickets
   - `POST /api/tickets/status/:ticketId`: Add approval check for `user` role:
     ```javascript
     async function statusChange(req, res) {
       const ticket = await TicketService.getOne(req.params.ticketId);
       const user = await User.find(req.user.userId);

       // If user is AI agent and trying to move to done, require approval
       if (user.role === 'user' && req.body.status === 'done') {
         if (ticket.status !== 'review') {
           return res.status(400).json({ error: 'AI agents can only submit for review, not mark as done' });
         }
         // Create approval request in approval_requests table
         await ApprovalRequest.create(ticket.id, req.user.userId);
         return res.json({ message: 'Approval request submitted. Awaiting review.' });
       }

       await TicketService.updateStatus(req.params.ticketId, req.body.status, req.user.userId);
       res.json({ message: 'Status updated' });
     }
     ```
3. Create `backend/src/models/approval.js` — approval request tracking:
   ```javascript
   class ApprovalRequest {
     static async create(ticketId, requestedBy) {
       return pool.query(
         `INSERT INTO approval_requests (ticket_id, requested_by, status)
          VALUES ($1, $2, 'pending') RETURNING *`,
         [ticketId, requestedBy]
       );
     }

     static async approve(approvalId, approvedBy) {
       return pool.query(
         `UPDATE approval_requests
          SET status = 'approved', approved_by = $2, approved_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING *`,
         [approvalId, approvedBy]
       );
     }

     static async reject(approvalId, approvedBy) {
       return pool.query(
         `UPDATE approval_requests
          SET status = 'rejected', approved_by = $2, approved_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING *`,
         [approvalId, approvedBy]
       );
     }
   }
   ```
4. Update frontend `frontend/src/views/TicketDetail.vue`:
   - Hide status transition buttons for `user` role when status is `review` (show "Submit for Review" instead)
   - Show approval status badge when ticket is awaiting approval

### c) Dependencies
- RS-3 (Auth middleware — role checks)
- RS-7 (Ticket Delete — for consistent permission patterns)

### d) Risks/Edge Cases
- **Approval workflow**: Who can approve? project_admin or member roles
- **Approval timeout**: Auto-reject after 7 days if no action
- **Audit trail**: Log all approval actions
- **UI clarity**: Show clear messaging to AI agents about approval requirements

### e) Testing
- **Unit tests**: `backend/src/__tests__/unit.test.js` — test `ApprovalService` and approval model:
  - `ApprovalService.create()` → creates pending request
  - `ApprovalService.approve()` by project_admin → marks approved, updates ticket status
  - `ApprovalService.approve()` by user role → throws forbidden
  - `ApprovalService.reject()` → marks rejected
  - `ApprovalRequest.create()` → inserts into DB
  - `ApprovalRequest.approve()` → updates status
  - `ApprovalRequest.findByTicketAndRequester()` → finds existing pending request
  - `ApprovalRequest.getPendingByRequester()` → lists pending requests for user
  - Status change to `done` by `user` role creates approval request
  - Status change to `done` by admin bypasses approval
- **E2E tests**: Approval workflow
  - `user` role changes ticket to `done` → creates approval request
  - `project_admin` can approve/reject pending approvals
  - `user` role cannot approve/reject → 403
  - Approved ticket transitions to `done`
  - Rejected ticket stays in previous status

### f) Notes
- Bash tests: `test_approvals_api()` verifies approval request creation, pending list, approve flow, cannot approve already-approved, and `user` role gets 403 on approvals.
