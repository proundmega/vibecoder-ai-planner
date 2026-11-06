# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`

---

## Implementation Steps

### Step 1: Extend `validate.js` Middleware (Q1, Q2, Q3)

**File**: `backend/src/middleware/validate.js`

Changes:
1. Add `query` schema support — validate `req.query` against `schema.query` Joi schema
2. Add `headers` schema support — validate `req.headers` against `schema.headers` Joi schema
3. Add `validatePathParams()` exported function — validates `req.params` against Joi schemas
4. Maintain backward compatibility — existing `validate({ body: ... })` calls continue to work

Before:
```javascript
module.exports = function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.body.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    next();
  };
};
```

After:
```javascript
module.exports = function validate(schema) {
  return (req, res, next) => {
    // Validate headers (if provided)
    if (schema.headers) {
      const { error } = schema.headers.validate(req.headers, { abortEarly: false });
      if (error) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }
    
    // Validate query params (if provided)
    if (schema.query) {
      const { error } = schema.query.validate(req.query, { abortEarly: false });
      if (error) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }
    
    // Validate body (existing behavior)
    if (schema.body) {
      const { error } = schema.body.validate(req.body);
      if (error) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }
    
    next();
  };
};

// Path parameter validation helper
module.exports.validatePathParams = function validatePathParams(params) {
  return (req, res, next) => {
    for (const [key, schema] of Object.entries(params)) {
      const value = req.params[key];
      const { error } = schema.validate(value);
      if (error) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }
    next();
  };
};
```

### Step 2: Create Joi Query Schemas

**Files**:
- `backend/src/validators/pagination.js`
- `backend/src/validators/statusFilter.js`
- `backend/src/validators/pathParams.js`

`pagination.js`:
```javascript
const Joi = require('joi');

module.exports = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});
```

`statusFilter.js`:
```javascript
const Joi = require('joi');

const TICKET_STATUSES = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

module.exports = Joi.object({
  status: Joi.string().valid(...TICKET_STATUSES).optional(),
  priority: Joi.string().valid(...PRIORITIES).optional(),
});
```

`pathParams.js`:
```javascript
const Joi = require('joi');

module.exports = {
  id: Joi.number().integer().positive(),
  ticketId: Joi.number().integer().positive(),
  projectId: Joi.number().integer().positive(),
  agentId: Joi.number().integer().positive(),
  userId: Joi.number().integer().positive(),
};
```

### Step 3: Apply Validation to Routes

**File**: `backend/src/api/v1/index.js`

Apply query validation to routes that accept query params:
- `GET /tickets` — add `validate({ query: statusFilterSchema })`
- `GET /agents` — add `validate({ query: paginationSchema })`
- `GET /projects` — add `validate({ query: paginationSchema })`
- `GET /milestones` — add `validate({ query: statusFilterSchema })`

Apply path validation to routes with `:id` params:
- `GET /tickets/:ticketId` — add `validatePathParams({ ticketId: pathParams.ticketId })`
- `GET /agents/:agentId` — add `validatePathParams({ agentId: pathParams.agentId })`
- `GET /projects/:projectId` — add `validatePathParams({ projectId: pathParams.projectId })`

Apply header validation to POST/PUT/PATCH routes:
- All routes with `validate({ body: ... })` — add `headers: Joi.object({ 'content-type': Joi.string().valid('application/json').required() })`

### Step 4: Enable Response Validation (Q4)

**File**: `backend/src/middleware/errorHandler.js` or response wrapper

Add optional response validation:
```javascript
const enableResponseValidation = process.env.RESPONSE_VALIDATION === 'true';

if (enableResponseValidation) {
  const { error } = responseSchema.validate(responseData);
  if (error) {
    logger.error('Response validation failed:', error.message);
    // Return sanitized response, do not crash
  }
}
```

**File**: `backend/.env.example`
Add: `RESPONSE_VALIDATION=false`

### Step 5: Create Tests

**File**: `backend/src/__tests__/validate.test.js` (new)

Tests:
1. `validate()` — body validation (existing behavior, regression)
2. `validate()` — query validation (new)
3. `validate()` — header validation (new)
4. `validatePathParams()` — valid path params (new)
5. `validatePathParams()` — invalid path params (new)
6. `validate()` — combined query + body (new)
7. `validate()` — missing Content-Type on POST (new)
8. `validate()` — query param type errors (NaN, negative) (new)
9. `validate()` — query param range errors (limit > 100) (new)

### Step 6: Regression Tests

**File**: `backend/src/__tests__/validate.test.js`

Tests for existing endpoints that use query params:
1. `GET /tickets?status=review` — still works
2. `GET /agents?page=1&limit=20` — still works
3. `GET /tickets?status=invalid` — returns 400 (new regression)
4. `GET /agents?page=abc` — returns 400 (new regression)

---

## Files to Create/Modify

### Create
| File | Purpose |
|------|---------|
| `backend/src/validators/pagination.js` | Joi schema for pagination params |
| `backend/src/validators/statusFilter.js` | Joi schema for status/priority filters |
| `backend/src/validators/pathParams.js` | Joi schemas for common path parameters |
| `backend/src/__tests__/validate.test.js` | Tests for validate middleware extensions |

### Modify
| File | Change |
|------|--------|
| `backend/src/middleware/validate.js` | Add query, headers, and path param support |
| `backend/src/api/v1/index.js` | Apply validation to routes |
| `backend/.env.example` | Add `RESPONSE_VALIDATION` env var |

---

## Testing Steps

1. Run `npm test` — all existing tests pass (regression)
2. Run `npm run test:coverage` — 60% min threshold passes
3. Run `npm run lint` — no lint errors
4. Manual verification: curl endpoints with invalid query params → 400 error

---

## Post-Implementation Verification

1. `GET /api/v1/tickets?status=review` — returns filtered tickets (200)
2. `GET /api/v1/tickets?status=invalid` — returns 400 with validation error
3. `GET /api/v1/tickets?limit=-1` — returns 400 with validation error
4. `GET /api/v1/tickets?limit=abc` — returns 400 with validation error
5. `GET /api/v1/tickets/abc` — returns 400 (path param validation)
6. `POST /api/v1/tickets` without `Content-Type: application/json` — returns 400
7. `POST /api/v1/tickets` with `Content-Type: application/json` — works (200)

---

*Implementation follows existing patterns: Joi schemas, validate middleware, error handling conventions.*
