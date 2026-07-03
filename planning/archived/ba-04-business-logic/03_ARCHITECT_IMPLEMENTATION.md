# BA-4: Business Logic

**Status**: planned
**Priority**: P1
**Effort**: Large
**Dependencies**: BA-2 (Auth Middleware)

---

### a) Purpose

The business logic layer (services) contains all domain rules: status transitions, permission checks, data transformations, and cross-entity operations. It is framework-agnostic, testable in isolation, and shielded from HTTP concerns (headers, status codes, JSON serialization).

### b) Actions

1. Audit existing service classes in `backend/src/services/`:
   - `TicketService.js`
   - `ProjectService.js`
   - `UserService.js`
2. Move all HTTP-adjacent logic out of services:
   - Remove JSON formatting
   - Remove response status codes
   - Remove `req`/`res` references
3. Implement permission checks in services:
   - `TicketService.canUpdate(ticketId, userId)` — checks ownership/role
   - `ProjectService.canAccess(projectId, userId)` — checks ownership/membership
4. Standardize service method signatures:
   ```javascript
   // Consistent: (id, userId, data) → returns model or throws
   async update(id, userId, data) {
     const ticket = await this.findById(id);
     if (!this.canUpdate(ticket, userId)) throw new ForbiddenError();
     // ... business rules
   }
   ```
5. Implement status transition validation in service (not model):
   ```javascript
   const VALID_TRANSITIONS = {
     backlog: ['in_progress'],
     in_progress: ['review', 'backlog'],
     review: ['done', 'backlog'],
     done: [],
   };
   ```
6. Add unit tests for each service method (see Testing Guidelines in `01_ARCHITECT_REQUIREMENT.md`)

**Current issues to fix:**
- `TicketService.update()` calls `Ticket.findById()` internally — model should be pure data access
- `TicketService.getOne()` does not check project ownership — anyone can view any ticket
- `UserService.authenticate()` duplicates JWT signing logic from `auth.js`
- `Ticket.fromRow()` is marked `async` but has no `await` — remove `async` keyword

### c) Dependencies
- Model layer (`backend/src/models/`)
- Custom error classes (`backend/src/errors/`) — optional but recommended
- `console` for logging during development
- Database pool (`backend/src/db.js`)

### d) Risks/Edge Cases
- **Transaction scope**: Multi-step operations (create ticket + audit log) need DB transactions
- **Race conditions**: Two users updating same ticket — use `WHERE id = $1 AND updated_at = $2`
- **N+1 queries**: Service fetching ticket then comments then user — batch with JOINs or `pg-promise`
- **Orphaned data**: Deleting a project without cascading tickets — handle in service or DB
- **Silent failures**: Service methods returning `null` instead of throwing — prefer explicit errors
- **Leaky abstractions**: Services knowing about HTTP status codes — keep them framework-free

### e) Testing
- [ ] Status transitions: valid transitions succeed, invalid transitions throw
- [ ] Permission checks: `canUpdate()` returns correct boolean
- [ ] Service methods: no HTTP concerns (no `req`/`res`, no status codes)
- [ ] Method signatures: consistent `(id, userId, data)` pattern
- [ ] Error classes: custom errors with proper codes and status codes
- [ ] Transaction handling: multi-step operations wrapped in transactions

---
