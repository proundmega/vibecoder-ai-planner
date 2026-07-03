# RS-7: Ticket Delete

**Status**: completed
**Priority**: P2
**Effort**: Medium
**Author**: Lead Architect
**Date created**: 2026-06-05
**Date completed**: 2026-06-06
**PR**: feature/role-system-overhaul
**Branch**: feature/role-system-overhaul

**Dependencies**: RS-6 (Ticket Edit Modal — for consistent UI patterns)

---

### a) Purpose

Add delete functionality to tickets. Users can delete tickets they own or have permission to manage. Confirmation dialog required.

### b) Actions

1. Update `frontend/src/views/TicketDetail.vue`:
   - Add "Delete" button (visible for project_admin, member, or ticket owner)
   - Confirmation dialog: "Are you sure you want to delete this ticket? This action cannot be undone."
   - On confirm: call `deleteTicket(ticket.id)`, then redirect to `/projects/:id/tickets`
2. Update `frontend/src/api/tickets.js` — `deleteTicket()` already exists, verify it works:
   ```javascript
   export async function deleteTicket(id) {
     const response = await client.delete(`/tickets/${id}`);
     return response.data;
   }
   ```
3. Update backend `TicketService.delete()` — add authorization check:
   ```javascript
   async delete(id, userId) {
     const ticket = await Ticket.findById(id);
     if (!ticket) throw new Error('Ticket not found');

     // Check permission: owner or admin/member
     const user = await User.find(userId);
     if (ticket.owner_id !== userId && !['project_admin', 'member', 'super_admin'].includes(user.role)) {
       throw new Error('Forbidden: only ticket owner or admins can delete');
     }

     await Ticket.delete(id);
   }
   ```
4. Update `frontend/src/views/TicketBoard.vue` — add delete button to ticket cards:
   - Right-click or long-press for delete option
   - Or add "..." menu with delete option

### c) Dependencies
- RS-6 (Ticket Edit Modal — for consistent UI patterns)

### d) Risks/Edge Cases
- **Cascade delete**: Deleting a ticket should not cascade to comments (or should soft-delete comments)
- **AI agent tickets**: AI agents (`user` role) cannot delete tickets they created
- **Audit trail**: Log deletions in `ai_actions` table for compliance
- **Redirect**: After delete, redirect to ticket board (`/projects/:id/tickets`)

### e) Testing
- **Unit tests**: `backend/src/__tests__/unit.test.js` — test `TicketService.delete()`:
  - Ticket owner deletes own ticket → succeeds
  - `project_admin` deletes any ticket → succeeds
  - `member` deletes any ticket → succeeds
  - `user` (AI agent) deletes any ticket → throws forbidden
  - Non-owner, non-admin deletes ticket → throws forbidden
  - Ticket not found → throws error
- **Integration tests**: 60 tests in `backend/src/__tests__/integration/role-system.test.js` cover role-based delete

### f) Notes
- Fixed `TicketService.delete()` to throw `'Forbidden'` instead of a longer message, ensuring proper 403 response.
- Fixed `TicketService.delete()` to use `ownerId` (camelCase) instead of `owner_id` (snake_case) to match model property.
- Fixed `user role cannot delete others ticket` and `user role can delete own ticket` tests to properly create `user` role accounts.
- Bash tests: `test_role_based_ticket_permissions()` verifies member can delete tickets; verifies `user` role gets 403 deleting others' tickets but 200 deleting own tickets.
