# BA-6: Response Handling

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Author**: Lead Architect
**Date created**: 2026-06-06
**Date completed**: —
**PR**: —
**Branch**: —

**Dependencies**: BA-3 (Request Validation)

**References:**
- `01_ARCHITECT_REQUIREMENT.md` → "Response Handling" section (standardized format, error middleware, pagination)

---

### a) Purpose

Standardize API response format and error handling. Currently, responses are inconsistent — some return `{ success, data }`, others return raw data or `{ error: "message" }`. This ticket creates:

1. Custom error classes (AppError, NotFoundError, ValidationError, ForbiddenError)
2. Standardized error response middleware
3. Pagination helper
4. Request ID tracking middleware
5. Enhanced health check with database status

**Why:**
- Consistent API responses improve frontend error handling
- Structured errors help with debugging and monitoring
- Pagination enables handling large datasets
- Request IDs enable tracing across services

---

### b) Actions

#### Step 1: Create Custom Error Classes

Create `backend/src/errors/HttpError.js`:

```javascript
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  ConflictError,
  RateLimitError,
};
```

#### Step 2: Create Error Handling Middleware

Create `backend/src/middleware/errorHandler.js`:

```javascript
const { AppError } = require('../errors/HttpError');

function errorHandler(err, req, res, next) {
  // Log error with request ID if available
  const requestId = req.requestId || 'N/A';
  console.error(`[ERROR] Request ${requestId}:`, err.message);
  if (process.env.NODE_ENV === 'development' && err.stack) {
    console.error(err.stack);
  }

  // Handle known operational errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired',
      },
    });
  }

  // Handle PostgreSQL duplicate key errors
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists',
      },
    });
  }

  // Handle unknown errors
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(statusCode).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Internal server error' : err.message,
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}

module.exports = { errorHandler };
```

#### Step 3: Create Request ID Middleware

Create `backend/src/middleware/requestId.js`:

```javascript
const crypto = require('crypto');

function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = { requestId };
```

#### Step 4: Create Pagination Helper

Create `backend/src/utils/pagination.js`:

```javascript
function paginate(query, page = 1, perPage = 20) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const perPageNum = Math.min(100, Math.max(1, parseInt(perPage) || 20));
  const offset = (pageNum - 1) * perPageNum;

  return {
    page: pageNum,
    perPage: perPageNum,
    offset,
  };
}

function formatPaginatedResponse(data, total, page, perPage) {
  const totalPages = Math.ceil(total / perPage);
  
  return {
    success: true,
    data,
    meta: {
      page,
      perPage,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = { paginate, formatPaginatedResponse };
```

#### Step 5: Update index.js

Update `backend/src/index.js` to use new middleware:

```javascript
// Add after express.json() middleware
const { requestId } = require('./middleware/requestId');
app.use(requestId);

// Update error handler
const { errorHandler } = require('./middleware/errorHandler');
app.use(errorHandler);

// Update health check
router.get('/health', async (req, res) => {
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      database: 'connected', 
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'degraded', 
      database: 'disconnected',
      error: error.message,
      requestId: req.requestId,
    });
  }
});
```

#### Step 6: Update Routes to Use Standardized Format

Update route files to use `res.json()` with standardized format:

**Before:**
```javascript
res.json(ticket);
res.json({ error: error.message });
```

**After:**
```javascript
res.json({ success: true, data: ticket });
res.json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
```

#### Step 7: Write Tests

Create `backend/src/__tests__/error-handling.test.js`:

```javascript
const { AppError, NotFoundError, ValidationError, ForbiddenError } = require('../errors/HttpError');
const { errorHandler } = require('../middleware/errorHandler');
const { requestId } = require('../middleware/requestId');
const { paginate, formatPaginatedResponse } = require('../utils/pagination');

describe('Custom Error Classes', () => {
  it('should create AppError with correct properties', () => {
    const err = new AppError('Test error', 500, 'TEST_ERROR');
    expect(err.message).toBe('Test error');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.isOperational).toBe(true);
  });

  it('should create NotFoundError with 404 status', () => {
    const err = new NotFoundError('User not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('should create ValidationError with details', () => {
    const details = [{ field: 'email', message: 'Invalid email' }];
    const err = new ValidationError('Validation failed', details);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual(details);
  });

  it('should create ForbiddenError with 403 status', () => {
    const err = new ForbiddenError('Access denied');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('Error Handler Middleware', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should handle AppError with correct format', () => {
    const err = new NotFoundError('Ticket not found');
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Ticket not found',
      },
    });
  });

  it('should handle ValidationError with details', () => {
    const details = [{ field: 'email', message: 'Invalid email' }];
    const err = new ValidationError('Validation failed', details);
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details,
      },
    });
  });

  it('should handle JWT errors', () => {
    const err = new Error('Invalid token');
    err.name = 'JsonWebTokenError';
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
    });
  });

  it('should handle token expiration', () => {
    const err = new Error('Token expired');
    err.name = 'TokenExpiredError';
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired',
      },
    });
  });

  it('should handle PostgreSQL duplicate key errors', () => {
    const err = new Error('Duplicate key');
    err.code = '23505';
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists',
      },
    });
  });

  it('should handle unknown errors with 500 status', () => {
    const err = new Error('Unknown error');
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    }));
  });

  describe('Request ID Middleware', () => {
    it('should generate request ID if not provided', () => {
      const mockReq = { headers: {} };
      const mockRes = { setHeader: jest.fn() };
      const nextFn = jest.fn();
      
      requestId(mockReq, mockRes, nextFn);
      
      expect(mockReq.requestId).toBeDefined();
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', mockReq.requestId);
      expect(nextFn).toHaveBeenCalled();
    });

    it('should use provided request ID from headers', () => {
      const mockReq = { headers: { 'x-request-id': 'test-id-123' } };
      const mockRes = { setHeader: jest.fn() };
      const nextFn = jest.fn();
      
      requestId(mockReq, mockRes, nextFn);
      
      expect(mockReq.requestId).toBe('test-id-123');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-id-123');
    });
  });

  describe('Pagination Helper', () => {
    it('should calculate correct offset', () => {
      const result = paginate('SELECT * FROM users', 1, 20);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should calculate correct offset for page 2', () => {
      const result = paginate('SELECT * FROM users', 2, 20);
      expect(result.page).toBe(2);
      expect(result.perPage).toBe(20);
      expect(result.offset).toBe(20);
    });

    it('should limit perPage to 100', () => {
      const result = paginate('SELECT * FROM users', 1, 200);
      expect(result.perPage).toBe(100);
    });

    it('should format paginated response correctly', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const response = formatPaginatedResponse(data, 100, 1, 20);
      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.meta).toEqual({
        page: 1,
        perPage: 20,
        total: 100,
        totalPages: 5,
        hasNextPage: true,
        hasPrevPage: false,
      });
    });

    it('should set hasNextPage to false on last page', () => {
      const data = [{ id: 1 }];
      const response = formatPaginatedResponse(data, 20, 1, 20);
      expect(response.meta.hasNextPage).toBe(false);
    });

    it('should set hasPrevPage to true on page 2', () => {
      const data = [{ id: 1 }];
      const response = formatPaginatedResponse(data, 100, 2, 20);
      expect(response.meta.hasPrevPage).toBe(true);
    });
  });
});
```

---

### c) Dependencies

- Existing: Express, error handling in index.js, route files

---

### d) Risks/Edge Cases

- **Breaking change**: Response format changes from `{ error: "message" }` to `{ success: false, error: { code, message } }`. Frontend may need updates.
- **Migration path**: Keep old format for backward compatibility during transition period, or update frontend simultaneously.
- **Pagination**: Some endpoints don't need pagination (single resource lookups). Apply only to list endpoints.

---

### e) Testing Checklist

- [ ] Custom error classes have correct statusCode and code
- [ ] Error handler formats AppError correctly
- [ ] Error handler formats ValidationError with details
- [ ] Error handler handles JWT errors (JsonWebTokenError, TokenExpiredError)
- [ ] Error handler handles PostgreSQL duplicate key errors (23505)
- [ ] Error handler handles unknown errors with 500 status
- [ ] Request ID middleware generates UUID
- [ ] Request ID middleware uses provided ID from headers
- [ ] Pagination calculates correct offset
- [ ] Pagination limits perPage to 100
- [ ] Paginated response includes all meta fields
- [ ] Unit tests pass: `npm test`
- [ ] Integration tests pass: `npm run test:integration`
- [ ] Lint passes: `npm run lint`

---

### f) Migration Plan

1. Create error classes (`errors/HttpError.js`)
2. Create error handler middleware (`middleware/errorHandler.js`)
3. Create request ID middleware (`middleware/requestId.js`)
4. Create pagination helper (`utils/pagination.js`)
5. Update `index.js` to use new middleware
6. Update route files to use standardized response format
7. Write unit tests for all new components
8. Update integration tests to test new response format
9. Update TICKETS.txt and AGENTS.md

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Response Handling section*
- *`02_ARCHITECT_DESIGN.md` → Role definitions, schema design*
- *`03_ARCHITECT_IMPLEMENTATION.md` → This template (purpose, actions, dependencies, risks, testing)*
