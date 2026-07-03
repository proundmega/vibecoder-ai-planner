# 02_ARCHITECT_DESIGN.md — Input Validation on All Endpoints

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

Some endpoints handle `req.body` directly without Joi validation:
- `agents.js` — creates tickets, edits tickets, claims tickets
- `approvals.js` — creates approval requests
- `memory.js` — adds/updates memories
- `providers.js` — adds/updates providers
- `credentials.js` — adds/updates credentials
- `github.js` — connects repos, creates branches/PRs

---

## Current State

```javascript
// agents.js — no validation
router.post('/tickets/create', async (req, res) => {
  const { projectId, title, description } = req.body;  // Raw body
  // ...
});

// approvals.js — partial validation
router.post('/', async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) {
    return res.status(400).json({ error: 'ticketId is required' });
  }
  // ...
});
```

---

## Design

### Joi Schemas

```javascript
// backend/src/validators/agents.js
const Joi = require('joi');

exports.createTicketSchema = Joi.object({
  projectId: Joi.string().uuid().required(),
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(10000).allow(''),
  tags: Joi.array().items(Joi.string()).max(10),
});

exports.editTicketSchema = Joi.object({
  title: Joi.string().min(1).max(200),
  description: Joi.string().max(10000).allow(''),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done'),
  priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
  tags: Joi.array().items(Joi.string()).max(10),
});
```

### Apply Validation Middleware

```javascript
// agents.js
const { createTicketSchema, editTicketSchema } = require('../validators/agents');

router.post('/tickets/create', 
  validate(createTicketSchema), 
  agentAuthMiddleware, 
  async (req, res) => { ... }
);
```

### Validation Middleware

```javascript
// backend/src/middleware/validate.js
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      error: 'Validation error',
      details: error.details.map(d => d.message),
    });
  }
  next();
};
```

### Alternative Designs Considered

- **Zod over Joi** — Chose Joi over Zod because: Joi is already used throughout the codebase (auth validators exist), so introducing a new library would create inconsistency. Zod was considered but rejected because: it would require rewriting all existing auth validators and creating a migration path.
- **Validation in service layer vs middleware** — Chose middleware-level validation over service-layer validation because: it catches bad input before any business logic runs, providing consistent error responses and preventing wasted DB queries. Service-layer validation was considered but rejected because: it would require adding validation checks to every service method, leading to duplicated logic and inconsistent error formats.
- **Partial validation (only required fields)** — Chose strict validation (reject unknown fields by default) over lax validation because: it catches client bugs early and prevents accidental field injection. Lax validation was considered but rejected because: silently ignoring unknown fields can lead to data integrity issues and makes it harder to debug client-server mismatches.

### Data Flow Diagram

```
Client Request → POST /api/tickets/create
    ↓
[validate(createTicketSchema)]
    ↓
  Joi.validate(req.body)
    ↓
  [valid?]
    ├─ No → 400 Bad Request → { error: 'Validation error', details: [...] }
    └─ Yes → next()
                ↓
[agentAuthMiddleware]
                ↓
[handler] → service layer → DB → response
```

### Config / Env Changes

- NEW: `backend/src/validators/agents.js` — Joi schemas for agent ticket operations
- NEW: `backend/src/validators/approvals.js` — Joi schemas for approval operations
- NEW: `backend/src/validators/memory.js` — Joi schemas for memory operations
- NEW: `backend/src/validators/providers.js` — Joi schemas for provider operations
- NEW: `backend/src/validators/credentials.js` — Joi schemas for credential operations
- NEW: `backend/src/validators/github.js` — Joi schemas for GitHub operations
- CHANGED: `backend/src/api/agents.js` — apply `validate()` to all POST/PUT routes
- CHANGED: `backend/src/api/approvals.js` — apply `validate()` to all POST/PUT routes
- CHANGED: `backend/src/api/memory.js` — apply `validate()` to all POST/PUT routes
- CHANGED: `backend/src/api/providers.js` — apply `validate()` to all POST/PUT routes
- CHANGED: `backend/src/api/credentials.js` — apply `validate()` to all POST/PUT routes
- CHANGED: `backend/src/api/github.js` — apply `validate()` to all POST/PUT routes

---

## Dependencies

- **Joi** — already installed
- **validate middleware** — already exists

---

## Risks/Edge Cases

- **[Backward compatibility]**: New validation may reject previously accepted input. Mitigation: use permissive schemas first, tighten over time.
- **[Agent API]**: Agents may send non-JSON body. Ensure validation handles this gracefully.
- **[Error messages]**: Joi error messages may contain internal details. Sanitize before sending to client.

---

*Ready for implementation phase.*
