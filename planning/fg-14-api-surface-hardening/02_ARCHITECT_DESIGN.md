# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The frontend↔backend API surface audit (fg-13) found that while request **body** validation exists for most endpoints via Joi schemas, **query parameters, path parameters, and request headers have no validation**. Response schemas are also unvalidated in production. This creates attack surfaces for malformed input and inconsistent error handling.

---

## Current State

### Existing Validation Layer

- `backend/src/middleware/validate.js` — Joi-based validation middleware, supports `body` schemas only
- `backend/src/validators/` — 15 Joi schemas covering request bodies (users, tickets, agents, auth, etc.)
- `frontend/src/api/validator.ts` — Response validation, but only active when `NODE_ENV === 'test'`
- Most routes use `validate(schema)` middleware for body validation
- Query params (`?page=`, `?limit=`, `?status=`) are used but never validated
- Path params (`:id`) are parsed with `parseInt()` but never validated for valid ranges
- Headers are not validated (any `Content-Type` accepted for JSON endpoints)

### Key Gaps

| Gap | Current Behavior | Risk |
|-----|-----------------|------|
| Query params | `?page=abc` → `NaN` → `LIMIT NaN` (PostgreSQL accepts, returns 0 rows) | Silent data loss, confusing errors |
| Path params | `:id=abc` → `parseInt('abc')` = `NaN` → `WHERE id = NaN` (returns 0 rows) | Silent failures, no 400 error |
| Headers | `Content-Type: text/plain` accepted for JSON POST | MIME-type confusion potential |
| Responses | No validation in production | Clients receive malformed data |

---

## Design

### Q1 — Query Parameter Validation

**Approach**: Extend `validate.js` middleware to accept `query` schemas alongside existing `body` schemas.

```javascript
// Current (body only)
validate({ body: Joi.object({ name: Joi.string().required() })})

// Proposed (query + body)
validate({ 
  query: Joi.object({ 
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional()
  }),
  body: Joi.object({ name: Joi.string().required() })
})
```

**Validation schemas to create**:
- `backend/src/validators/pagination.js` — `page` (integer ≥ 1, default 1), `limit` (integer 1-100, default 20)
- `backend/src/validators/statusFilter.js` — `status` (one of ticket statuses), `priority` (one of priority levels)
- `backend/src/validators/sortParams.js` — `sort` (field name), `order` (asc/desc)

**Routes to apply** (identified from grep of query param usage):
- `GET /tickets` (status filter)
- `GET /agents` (pagination)
- `GET /usage` (date range, pagination)
- `GET /projects` (pagination)
- `GET /milestones` (status filter)

### Q2 — Path Parameter Validation

**Approach**: Create `validatePathParams()` helper that validates `:id` params are valid integers.

```javascript
// middleware/validate.js
function validatePathParams(params) {
  return (req, res, next) => {
    for (const [key, schema] of Object.entries(params)) {
      const value = req.params[key];
      const { error } = schema.validate(value);
      if (error) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.message }
        });
      }
    }
    next();
  };
}

// Usage in routes
router.get('/tickets/:ticketId', validatePathParams({ ticketId: Joi.number().integer().positive() }), handler);
```

**Schemas to create**:
- `backend/src/validators/pathParams.js` — Common path param schemas (`id`, `ticketId`, `projectId`, `agentId`)

### Q3 — Request Header Validation

**Approach**: Extend `validate.js` to support `headers` schema validation.

```javascript
// In validate.js
function validate(req, res, next) {
  const schema = req.validationSchema;
  
  // Validate headers
  if (schema.headers) {
    const { error } = schema.headers.validate(req.headers);
    if (error) return res.status(400).json({ ... });
  }
  
  // Validate query
  if (schema.query) {
    const { error } = schema.query.validate(req.query);
    if (error) return res.status(400).json({ ... });
  }
  
  // Validate body (existing)
  if (schema.body) {
    const { error } = schema.body.validate(req.body);
    if (error) return res.status(400).json({ ... });
  }
  
  next();
}
```

**Header schema**:
```javascript
headers: Joi.object({
  'content-type': Joi.string().valid('application/json').required()
}).options({ allowUnknown: true, stripUnknown: false })
```

**Routes to apply**: All POST/PUT/PATCH routes that accept JSON bodies.

### Q4 — Response Schema Validation in Production

**Approach**: Enable response validation when `RESPONSE_VALIDATION=true` env var is set.

```javascript
// In middleware/errorHandler.js or response wrapper
const enableResponseValidation = process.env.RESPONSE_VALIDATION === 'true';

if (enableResponseValidation) {
  const { error } = responseSchema.validate(responseData);
  if (error) {
    logger.error('Response validation failed:', error.message);
    // Log but do not crash — return sanitized response
  }
}
```

**Behavior**:
- **Production** (`RESPONSE_VALIDATION=true`): Log failures, return sanitized response (do not crash)
- **Test** (`NODE_ENV=test`): Fail the request (existing behavior)
- **Default** (`RESPONSE_VALIDATION` not set): No validation (backward compatible)

---

## Alternatives Considered

### Q1 — Query Validation

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Extend `validate.js` | Single middleware, consistent with existing pattern | Requires middleware changes | **Selected** |
| Separate `validateQuery.js` middleware | Isolated, no changes to existing middleware | More middleware to maintain | Rejected |
| Joi `query` option in route definition | Built-in Express support | Less flexible, harder to test | Rejected |

### Q2 — Path Validation

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Middleware-based `validatePathParams()` | Reusable, consistent with body validation | Requires route changes | **Selected** |
| Route parameter casting (Express 5.x) | Automatic, no code changes | Requires Express upgrade, not available now | Rejected |
| `parseInt()` with manual check in each controller | Simple | Duplicated code, easy to forget | Rejected |

### Q3 — Header Validation

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Extend `validate.js` | Consistent, single entry point | Middleware changes | **Selected** |
| Custom header middleware per route | Flexible | Duplicated code | Rejected |
| No header validation | Simplest | MIME-type confusion risk | Rejected |

### Q4 — Response Validation

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Env var toggle (`RESPONSE_VALIDATION`) | Opt-in, backward compatible | Requires schema definitions | **Selected** |
| Always-on response validation | Safety first | Breaking change, will fail existing responses | Rejected |
| No response validation | Simplest | No safety net | Rejected |

---

## Security Considerations

- Query parameter validation prevents SQL injection via malformed params
- Path parameter validation prevents `NaN` propagation to SQL
- Content-Type validation prevents MIME-type confusion
- Response validation (when enabled) catches malformed server responses
- No secrets exposed in validation error messages

---

## Performance Considerations

- Joi validation: ~0.1ms per validation (measured in existing tests)
- Total estimated overhead per request: <0.5ms (negligible)
- Response validation adds ~0.2ms when enabled (configurable off)

---

*Design follows existing patterns: Joi schemas, validate middleware, error handling conventions.*
