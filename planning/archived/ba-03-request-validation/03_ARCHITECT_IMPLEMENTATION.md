# BA-3: Request Validation

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Author**: Lead Architect
**Date created**: 2026-06-06
**Date completed**: —
**PR**: —
**Branch**: —

**Dependencies**: BA-1 (Controller Setup), BA-2 (Authentication Middleware)

**References:**
- `01_ARCHITECT_REQUIREMENT.md` → "Request Validation" section (Joi schemas, validation middleware)

---

### a) Purpose

Add Joi-based request validation to the API. Currently, validation is scattered across route handlers and services with manual string checks. This ticket creates a centralized `validators/` directory with Joi schemas and a reusable validation middleware, then applies it to all endpoints.

**Why Joi:**
- Expressive, chainable schema definition
- Well-maintained and widely used in Express ecosystem
- Detailed error messages with `error.details`
- Type coercion control (disable by default)
- Built-in transforms and custom validators

**Scope:**
1. Install `joi` dependency
2. Create `validators/` directory with schema files per domain
3. Create validation middleware function
4. Apply validation to auth, projects, tickets, and users endpoints
5. Write unit tests for all schemas and middleware

---

### b) Actions

#### Step 1: Install Joi

```bash
cd backend && npm install joi
```

#### Step 2: Create Validation Middleware

Create `backend/src/middleware/validate.js`:

```javascript
const Joi = require('joi');

function validate(schema) {
  return (req, res, next) => {
    const options = {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false,
    };

    const { error, value } = schema.validate(req.body, options);

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details,
        },
      });
    }

    req.body = value;
    next();
  };
}

module.exports = { validate };
```

#### Step 3: Create Validation Schemas

Create `backend/src/validators/` directory with the following files:

**`auth.js`** — Authentication schemas:
```javascript
const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Name is required',
    'string.min': 'Name must be at least 1 character',
    'string.max': 'Name must not exceed 100 characters',
    'any.required': 'Name is required',
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Email must be a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(6).max(128).required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
  role: Joi.string().valid('user', 'member', 'project_admin').optional().default('user'),
  user_created_by: Joi.string().uuid().optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Email must be a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
});

module.exports = { registerSchema, loginSchema };
```

**`projects.js`** — Project schemas:
```javascript
const Joi = require('joi');

const createProjectSchema = Joi.object({
  name: Joi.string().min(1).max(200).required().messages({
    'string.empty': 'Project name is required',
    'string.min': 'Project name must be at least 1 character',
    'string.max': 'Project name must not exceed 200 characters',
    'any.required': 'Project name is required',
  }),
  description: Joi.string().max(2000).allow('').optional().default(''),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(1).max(200).required().messages({
    'string.empty': 'Project name is required',
    'string.min': 'Project name must be at least 1 character',
    'string.max': 'Project name must not exceed 200 characters',
    'any.required': 'Project name is required',
  }),
  description: Joi.string().max(2000).allow('').optional().default(''),
});

module.exports = { createProjectSchema, updateProjectSchema };
```

**`tickets.js`** — Ticket schemas:
```javascript
const Joi = require('joi');

const createTicketSchema = Joi.object({
  projectId: Joi.string().uuid().required().messages({
    'string.guid': 'Project ID must be a valid UUID',
    'any.required': 'Project ID is required',
  }),
  title: Joi.string().min(1).max(500).required().messages({
    'string.empty': 'Ticket title is required',
    'string.min': 'Ticket title must be at least 1 character',
    'string.max': 'Ticket title must not exceed 500 characters',
    'any.required': 'Ticket title is required',
  }),
  description: Joi.string().max(10000).allow('').optional().default(''),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional().default('medium'),
});

const updateTicketSchema = Joi.object({
  title: Joi.string().min(1).max(500).optional(),
  description: Joi.string().max(10000).allow('').optional(),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  assigneeId: Joi.string().uuid().allow(null).optional(),
});

const statusTransitionSchema = Joi.object({
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').required().messages({
    'any.only': 'Status must be one of: backlog, in_progress, review, done',
    'any.required': 'Status is required',
  }),
});

const commentSchema = Joi.object({
  content: Joi.string().min(1).max(5000).required().messages({
    'string.empty': 'Comment content is required',
    'string.min': 'Comment content must be at least 1 character',
    'string.max': 'Comment content must not exceed 5000 characters',
    'any.required': 'Comment content is required',
  }),
});

module.exports = { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema };
```

**`users.js`** — User schemas:
```javascript
const Joi = require('joi');

const createUserSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Name is required',
    'string.min': 'Name must be at least 1 character',
    'string.max': 'Name must not exceed 100 characters',
    'any.required': 'Name is required',
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Email must be a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(6).max(128).required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
  role: Joi.string().valid('user', 'member', 'project_admin').required().messages({
    'any.only': 'Role must be one of: user, member, project_admin',
    'any.required': 'Role is required',
  }),
});

const updateUserSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  role: Joi.string().valid('user', 'member', 'project_admin').optional(),
});

module.exports = { createUserSchema, updateUserSchema };
```

#### Step 4: Apply Validation to Routes

Update route files to use validation middleware:

**`api/routes.js`** — Auth endpoints:
```javascript
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validators/auth');

router.post('/auth/register', validate(registerSchema), async (req, res) => { ... });
router.post('/auth/login', validate(loginSchema), async (req, res) => { ... });
```

**`api/tickets.js`** — Ticket endpoints:
```javascript
const { validate } = require('../middleware/validate');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema } = require('../validators/tickets');

router.post('/', validate(createTicketSchema), async (req, res) => { ... });
router.put('/:ticketId', verifyToken, validate(updateTicketSchema), async (req, res) => { ... });
router.post('/:ticketId/status', verifyToken, validate(statusTransitionSchema), async (req, res) => { ... });
router.post('/:ticketId/comments', validate(commentSchema), async (req, res) => { ... });
```

**`api/projects.js`** — Project endpoints:
```javascript
const { validate } = require('../middleware/validate');
const { createProjectSchema, updateProjectSchema } = require('../validators/projects');

router.post('/', validate(createProjectSchema), async (req, res) => { ... });
router.put('/:id', validate(updateProjectSchema), async (req, res) => { ... });
```

**`api/users.js`** — User endpoints:
```javascript
const { validate } = require('../middleware/validate');
const { createUserSchema, updateUserSchema } = require('../validators/users');

router.post('/', validate(createUserSchema), async (req, res) => { ... });
router.put('/:id', validate(updateUserSchema), async (req, res) => { ... });
```

#### Step 5: Write Tests

Create `backend/src/__tests__/validation.test.js`:

```javascript
const Joi = require('joi');
const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validators/auth');
const { createTicketSchema, updateTicketSchema, commentSchema } = require('../validators/tickets');
const { createProjectSchema, updateProjectSchema } = require('../validators/projects');
const { createUserSchema, updateUserSchema } = require('../validators/users');

describe('Validation Middleware', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should pass valid data through to next()', () => {
    mockReq = { body: { email: 'test@example.com', password: 'password123' } };
    const middleware = validate(loginSchema);
    middleware(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalled();
  });

  it('should return 400 with details on invalid data', () => {
    mockReq = { body: { email: 'invalid', password: '' } };
    const middleware = validate(loginSchema);
    middleware(mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    }));
  });

  it('should include field-level error details', () => {
    mockReq = { body: { email: 'invalid', password: '' } };
    const middleware = validate(loginSchema);
    middleware(mockReq, mockRes, nextFn);
    const callArgs = mockRes.json.mock.calls[0][0];
    expect(callArgs.error.details).toHaveLength(2);
    expect(callArgs.error.details[0].field).toBe('email');
  });
});

describe('Auth Schemas', () => {
  it('should validate valid registration data', () => {
    const { error } = registerSchema.validate({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });
    expect(error).toBeUndefined();
  });

  it('should reject registration with short password', () => {
    const { error } = registerSchema.validate({
      name: 'Test User',
      email: 'test@example.com',
      password: 'short',
    });
    expect(error).toBeDefined();
    expect(error.details[0].message).toContain('at least 6 characters');
  });

  it('should reject registration with invalid email', () => {
    const { error } = registerSchema.validate({
      name: 'Test User',
      email: 'not-an-email',
      password: 'password123',
    });
    expect(error).toBeDefined();
  });
});

describe('Ticket Schemas', () => {
  it('should validate valid ticket creation', () => {
    const { error } = createTicketSchema.validate({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Fix login bug',
      description: 'Users cannot login',
      priority: 'high',
    });
    expect(error).toBeUndefined();
  });

  it('should default priority to medium', () => {
    const { error, value } = createTicketSchema.validate({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Fix login bug',
    });
    expect(error).toBeUndefined();
    expect(value.priority).toBe('medium');
  });

  it('should reject ticket without title', () => {
    const { error } = createTicketSchema.validate({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(error).toBeDefined();
  });
});
```

---

### c) Dependencies

- `joi` (npm package)
- Existing: Express, route modules, service layer

---

### d) Risks/Edge Cases

- **Schema drift**: Schemas must stay in sync with service validation logic. Remove duplicate validation from services once schemas are applied.
- **Backward compatibility**: Existing API clients may send fields not in schemas. Use `allowUnknown: true` in validation options to avoid breaking changes.
- **Error format change**: Response format changes from `{ error: "message" }` to `{ success: false, error: { code, message, details } }`. Frontend may need updates.
- **UUID validation**: Some tests use string IDs that aren't valid UUIDs. Schema will reject them — may need to relax for legacy data.

---

### e) Testing Checklist

- [ ] All schemas validate correct input
- [ ] All schemas reject invalid input with meaningful errors
- [ ] Validation middleware returns 400 with structured error details
- [ ] Validation middleware passes valid data through to next()
- [ ] Default values are applied (priority defaults to 'medium', etc.)
- [ ] Auth endpoints: register and login validation
- [ ] Projects endpoints: create and update validation
- [ ] Tickets endpoints: create, update, status change, comment validation
- [ ] Users endpoints: create and update validation
- [ ] Unit tests pass: `npm test`
- [ ] Integration tests pass: `npm run test:integration`
- [ ] Lint passes: `npm run lint`

---

### f) Migration Plan

1. Install `joi`
2. Create `middleware/validate.js`
3. Create `validators/` directory with all schema files
4. Add validation middleware to routes (one domain at a time)
5. Write unit tests for all schemas
6. Remove duplicate validation from services (optional, follow-up)
7. Update integration tests to test validation error responses
8. Update TICKETS.txt and AGENTS.md

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Request Validation section*
- *`02_ARCHITECT_DESIGN.md` → Role definitions, schema design*
- *`03_ARCHITECT_IMPLEMENTATION.md` → This template (purpose, actions, dependencies, risks, testing)*
