# RS-6: Ticket Edit Modal

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Dependencies**: RS-3 (Auth middleware — role checks)

---

### a) Purpose

Add edit functionality to ticket detail view. Users can edit title, description, priority, and assignee via a modal. Status transitions remain as quick-action buttons.

### b) Actions

1. Update `frontend/src/views/TicketDetail.vue`:
   - Add "Edit" button (visible for project_admin, member, or ticket assignee)
   - Create edit modal with fields:
     - Title (text input)
     - Description (textarea)
     - Priority (dropdown: low, medium, high, urgent)
     - Assignee (dropdown: users in same project)
   - Save button triggers `updateTicket(ticket.id, updates)`
   - Cancel button closes modal without saving
   - Loading state during save
2. Update `frontend/src/api/tickets.js` — `updateTicket()` already exists, verify it works:
   ```javascript
   export async function updateTicket(id, updates) {
     const response = await client.put(`/tickets/${id}`, updates);
     return response.data;
   }
   ```
3. Update backend `TicketService.update()` — ensure it handles partial updates:
   ```javascript
   async update(id, data, userId) {
     const ticket = await Ticket.findById(id);
     if (!ticket) throw new Error('Ticket not found');

     // Validate status transitions if status is being updated
     if (data.status && ticket.status !== data.status) {
       const validTransitions = {
         backlog: ['in_progress'],
         in_progress: ['review', 'backlog'],
         review: ['done', 'backlog'],
         done: [],
       };
       if (!validTransitions[ticket.status]?.includes(data.status)) {
         throw new Error('Invalid status transition');
       }
     }

     return await Ticket.update(id, data);
   }
   ```
4. Update `frontend/src/views/TicketBoard.vue` — add edit button to ticket cards:
   - Click ticket card → navigate to detail view
   - Add pencil icon on hover for quick edit

### c) Dependencies
- RS-3 (Auth middleware — role checks)

### d) Risks/Edge Cases
- **Concurrency**: Two users editing same ticket → last write wins (or add optimistic locking)
- **Assignee validation**: Only users in same project can be assigned
- **Priority changes**: No validation needed (always allowed)
- **Empty title**: Prevent saving with empty title
- **Form reset**: Reset form on modal close/cancel

### e) Testing
- **Unit tests**: `backend/src/__tests__/unit.test.js` — test `TicketService.update()`:
  - Valid status transition (backlog → in_progress) → succeeds
  - Invalid status transition (backlog → done) → throws
  - Partial update (title only) → updates only title
  - Assignee not in project → throws error
  - Empty title → throws error
  - `TicketService.getOne()` checks project ownership → returns ticket
- **Component tests**: Edit modal renders and saves correctly
- **E2E tests**: Edit ticket flow works end-to-end

### f) Notes
- **Known bugs to fix before implementing**: `authStore.user` is a `ref` — must use `authStore.user.value` in script code (see AGENTS.md).
