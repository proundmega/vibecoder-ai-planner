# BA-1: Controller Setup

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Dependencies**: None

---

### a) Purpose

Controllers are the entry point for all HTTP requests. They route incoming requests to the correct handler, parse the request, delegate to business logic, and return responses. A well-structured controller layer keeps routes decoupled from business rules and makes testing straightforward.

### b) Actions

1. Create a `controllers/` directory under `backend/src/`
2. Define one controller file per domain (e.g., `ticketController.js`, `projectController.js`, `userController.js`)
3. Each controller exports functions that accept `(req, res, next)`
4. Map controller methods to route handlers in `api/routes.js`
5. Use Express Router instances for domain-specific route grouping
6. Implement consistent response shaping: `{ success, data, error, meta }`
7. Add route-level comments documenting expected behavior

**Example structure:**
```
backend/src/
  controllers/
    ticketController.js
    projectController.js
    userController.js
  api/
    routes.js          → mounts all routers
    tickets.js         → router → ticketController
    projects.js        → router → projectController
    user.js            → router → userController
```

**Example controller:**
```javascript
// controllers/ticketController.js
const TicketService = require('../services/TicketService');

async function getTicket(req, res, next) {
  try {
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

async function createTicket(req, res, next) {
  try {
    const { projectId, title, description, priority } = req.body;
    const ticket = await TicketService.create(projectId, title, description, priority, req.user.userId);
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

module.exports = { getTicket, createTicket, updateTicket, deleteTicket, listTickets };
```

### c) Dependencies
- Express.js (already in use)
- `express.Router()` (built-in)
- Service layer classes (`backend/src/services/`)

### d) Risks/Edge Cases
- **Tight coupling**: Controllers should not contain business logic — delegate to services
- **Inconsistent responses**: Some endpoints return `{ data }`, others return raw objects — standardize
- **Error leakage**: Unhandled errors in controllers crash the process — always pass to `next(error)`
- **Route ordering**: Express matches routes top-to-bottom; `/:id` before `/:id/comments` causes 404s
- **N+1 queries**: Controllers calling services that fire multiple queries per ticket — batch where possible

### e) Testing
- [ ] Controller delegates to service (mock service, verify call)
- [ ] Response shape matches `{ success, data, error, meta }`
- [ ] Errors passed to `next(error)`
- [ ] Route ordering tested with supertest

---
