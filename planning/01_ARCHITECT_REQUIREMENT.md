# 01_ARCHITECT_REQUIREMENT.md — Backend Architecture Guidelines

**Status**: Living reference — use when designing backend components.
**Scope**: General patterns for controllers, middleware, services, models, response handling, monitoring, and testing.
**Note**: This is a reference document, not a ticket plan. See `TICKETS.txt` for current tickets.

---

## Architecture Layers

```
HTTP Request → Routes → Middleware → Controllers → Services → Models → Database
                                    ↑              ↑
                              Auth/Role      Business Logic
                              Validation     Status Transitions
```

### Layer Responsibilities

| Layer | Responsibility | Framework Awareness |
|-------|---------------|---------------------|
| **Routes** | URL mapping, router grouping | Express only |
| **Middleware** | Auth, validation, error handling | Express only |
| **Controllers** | Request parsing, response shaping | Express only |
| **Services** | Business rules, permissions, transitions | Framework-agnostic |
| **Models** | DB queries, data mapping, transactions | pg (node-postgres) |

---

## Controller Patterns

Controllers are the entry point for HTTP requests. They route incoming requests to handlers, parse requests, delegate to services, and return responses.

**Key rules:**
- One controller per domain (e.g., `ticketController.js`)
- Export functions accepting `(req, res, next)`
- Map to route handlers in `api/routes.js`
- Use Express Router for domain-specific grouping
- Standardize response: `{ success, data, error, meta }`
- **Never** contain business logic — delegate to services

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
```

**Example controller:**
```javascript
async function getTicket(req, res, next) {
  try {
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}
```

**Risks:**
- Tight coupling: Controllers should not contain business logic
- Inconsistent responses: Standardize `{ success, data, error, meta }`
- Error leakage: Always pass to `next(error)`
- Route ordering: `/:id` before `/:id/comments` causes 404s

---

## Authentication Middleware

Auth middleware verifies identity of every request. Extracts JWT, validates signature/expiry, attaches payload to `req.user`.

**Key patterns:**
- `verifyToken`: Extract from `Authorization: Bearer <token>`, validate with `JWT_SECRET`, attach to `req.user`
- `agentAuth`: Check `X-API-Key` header, validate against `agents` table, attach `req.agent`
- Public routes: `/api/auth/register`, `/api/auth/login`, `/api/health`
- Authenticated routes: `/api/projects/*`, `/api/tickets/*`, `/api/users/*`
- Agent routes: `/api/agents/*`

**Centralize `JWT_SECRET`** — do not duplicate across files.

**Risks:**
- Secret rotation invalidates all tokens
- Algorithm confusion: specify `algorithms: ['HS256']`
- Token leakage in URLs or logs
- Missing header should return 401, not 500

---

## Request Validation

Validation ensures incoming data meets expected formats before reaching business logic.

**Recommended library: `joi`** (expressive, chainable, well-maintained)

**Patterns:**
- Create `validators/` directory with schema files per domain
- Define schemas: `createTicketSchema`, `updateTicketSchema`, `loginSchema`, etc.
- Validation middleware:
  ```javascript
  function validate(schema) {
    return (req, res, next) => {
      const { error, value } = schema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map(d => d.message)
        });
      }
      req.body = value;
      next();
    };
  }
  ```
- Apply to routes: `router.post('/', validate(createTicketSchema), controller.create)`

**Risks:**
- Schema drift from actual API usage
- Over-validation rejecting valid edge cases
- Missing schemas on new endpoints
- Type coercion by default — disable unless intentional

---

## Service Layer (Business Logic)

Services contain all domain rules: status transitions, permission checks, data transformations. Framework-agnostic and testable in isolation.

**Key rules:**
- No HTTP concerns (no `req`/`res`, no JSON formatting, no status codes)
- Consistent method signatures: `(id, userId, data) → returns model or throws`
- Status transition validation in service, not model
- Permission checks in service: `canUpdate(ticket, userId)`, `canAccess(project, userId)`

**Status transitions:**
```javascript
const VALID_TRANSITIONS = {
  backlog: ['in_progress'],
  in_progress: ['review', 'backlog'],
  review: ['done', 'backlog'],
  done: [],
};
```

**Risks:**
- Transaction scope for multi-step operations
- Race conditions: use `WHERE id = $1 AND updated_at = $2`
- N+1 queries: batch with JOINs
- Orphaned data: handle cascades in service or DB
- Silent failures: prefer explicit errors over `null` returns

---

## Model Layer (Persistence)

Models handle all database interactions: queries, transactions, data mapping. Only place that knows SQL dialect, table names, column types.

**Key rules:**
- `fromRow()` must be synchronous (no `await` inside — remove `async` keyword)
- All queries parameterized (`$1, $2`) — never interpolate strings
- Transaction support:
  ```javascript
  static async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  ```

**Recommended additions:**
- Soft delete: `ALTER TABLE ... ADD COLUMN deleted_at TIMESTAMP`
- Timestamp triggers: `set_updated_at()` function
- Indexes: `idx_tickets_project_id`, `idx_tickets_status`, `idx_tickets_owner_id`

**Risks:**
- SQL injection: always parameterized queries
- Connection leaks: set `max` connections, consider PgBouncer
- Schema drift: migrations not tracked — consider `migrations` table
- Deadlocks: use `SELECT FOR UPDATE` or retry logic
- Data loss: hard deletes with no audit trail

---

## Response Handling

Standardizes how the API communicates results and errors to clients.

**Standard response format:**
```json
// Success
{ "success": true, "data": { ... }, "meta": { "page": 1, "perPage": 20, "total": 100 } }

// Error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Title is required" } }
```

**Error handling middleware:**
```javascript
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: isProduction ? 'Internal server error' : err.message,
      ...(isProduction ? {} : { stack: err.stack }),
    }
  });
}
```

**Custom error classes:**
```javascript
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
// NotFoundError (404), ValidationError (400), ForbiddenError (403)
```

**Risks:**
- Stack traces in production — only include in development
- Status code mismatch between service and controller
- Large payloads — add size limits
- Idempotency: verify PUT/DELETE are idempotent

---

## Monitoring & Logging

**Structured logging with winston:**
```javascript
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' })]
      : []),
  ],
});
```

**Request ID tracking:**
```javascript
function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}
```

**Health check:**
```javascript
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'degraded', database: 'disconnected' });
  }
});
```

**Risks:**
- Log injection from user input — use structured logging
- Sensitive data in logs — filter passwords, tokens
- Log volume — sample or aggregate high-traffic endpoints
- Disk space — configure log rotation

---

## Testing Guidelines (MANDATORY)

**Unit and integration tests are required for every code change. No exceptions.**

Every PR, feature ticket, bug fix, and refactoring must include both unit tests and integration tests. A change without tests is not mergeable.

### Test File Locations
- **Unit tests**: `backend/src/__tests__/unit.test.js` (Jest, mocked DB)
- **Middleware tests**: `backend/src/middleware/*.test.js` (Jest, mocked req/res)
- **API endpoint tests**: `backend/src/__tests__/api-*.test.js` (Jest, supertest)
- **Integration tests**: `backend/src/__tests__/integration/*.test.js` (Jest, real PostgreSQL via Docker)
- **Bash integration tests**: `backend/integration-test/run.sh` (real Docker + PostgreSQL)

### Test Structure (Jest)
```javascript
describe('Service.method()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('should do X when Y', async () => {
    // Arrange: set up mocks
    User.find.mockResolvedValue({ role: 'project_admin' });
    pool.query.mockResolvedValue({ rows: [{ id: 1, role: 'member' }] });

    // Act
    const result = await Service.method(params);

    // Assert
    expect(result.role).toBe('member');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.any(Array)
    );
  });
});
```

### Testing Checklist per Ticket (MANDATORY)
- [ ] **Happy path**: Expected behavior with valid input
- [ ] **Role validation**: Correct roles allowed, incorrect roles rejected
- [ ] **Error cases**: Invalid input, missing data, forbidden access
- [ ] **Edge cases**: Null values, empty arrays, boundary conditions
- [ ] **Authorization**: Role-based access control works correctly
- [ ] **DB interactions**: Correct queries fired with correct parameters

### Mocking Strategy
| Dependency | Mock Approach |
|------------|---------------|
| `pg` pool | `pool.query = jest.fn().mockResolvedValue({ rows: [...] })` |
| Model methods | `User.find = jest.fn()`, `Ticket.findById = jest.fn()` |
| `jsonwebtoken` | `jwt.sign = jest.fn().mockReturnValue('mock-token')` |
| `bcryptjs` | `bcrypt.hash = jest.fn().mockResolvedValue('hashed')` |
| Express req/res | `res = { json: jest.fn(), status: jest.fn().mockReturnThis() }` |

### Integration Test Checklist
- [ ] Full request lifecycle: HTTP → middleware → service → DB → response
- [ ] Role-based access: correct 403 responses
- [ ] Data persistence: inserted/updated data survives across requests
- [ ] Migration: new tables/columns exist and work correctly
- [ ] Error handling: invalid requests return proper error responses

### CI Requirements (MANDATORY)
- `npm test` — unit tests with mocked DB **must pass**
- `npm run test:integration` — real PostgreSQL via Docker **must pass**
- `npm run lint` — no unused vars, no errors
- `bash backend/integration-test/run.sh` — bash integration tests **must pass**
- Frontend: `npm run typecheck` + `npm run build` **must pass**

### Anti-Patterns to Avoid
- ❌ Testing implementation details (exact SQL string) — test behavior instead
- ❌ Tests that depend on execution order — each test must be independent
- ❌ Skipping tests with `test.skip` — leave a TODO comment instead
- ❌ Testing multiple things in one test — one assertion per concept
- ❌ Real DB calls in unit tests — always mock
- ❌ Testing private methods — test through public API only
- ❌ **Merging code without tests — this is prohibited**
- ❌ **Running tests without verifying both unit AND integration suites pass**

### Code Change Requirements
Every code change (feature, bug fix, refactoring) must:
1. Write unit tests **before or alongside** the implementation
2. Write integration tests covering the full request lifecycle
3. Run `npm test` and `npm run test:integration` — both must pass
4. Update `backend/integration-test/run.sh` if the change affects API behavior
5. Pass `npm run lint` with zero errors

---

*This document is a living guideline. Review and update as the codebase evolves.*
