const { AppError, NotFoundError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError } = require('../errors/HttpError');
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
    expect(err.message).toBe('User not found');
  });

  it('should create NotFoundError with default message', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Resource not found');
  });

  it('should create ValidationError with details', () => {
    const details = [{ field: 'email', message: 'Invalid email' }];
    const err = new ValidationError('Validation failed', details);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual(details);
  });

  it('should create ValidationError without details', () => {
    const err = new ValidationError('Validation failed');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual([]);
  });

  it('should create ForbiddenError with 403 status', () => {
    const err = new ForbiddenError('Access denied');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('should create UnauthorizedError with 401 status', () => {
    const err = new UnauthorizedError('Not authenticated');
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('should create ConflictError with 409 status', () => {
    const err = new ConflictError('Email already exists');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });
});

describe('Error Handler Middleware', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockReq = {};
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

  it('should handle ForbiddenError', () => {
    const err = new ForbiddenError('Access denied');
    errorHandler(err, mockReq, mockRes, nextFn);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
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
    const callArgs = mockRes.json.mock.calls[0][0];
    expect(callArgs.success).toBe(false);
    expect(callArgs.error.code).toBe('INTERNAL_ERROR');
  });

  it('should not expose stack trace in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('Unknown error');
    errorHandler(err, mockReq, mockRes, nextFn);
    const callArgs = mockRes.json.mock.calls[0][0];
    expect(callArgs.error.stack).toBeUndefined();
    process.env.NODE_ENV = 'test';
  });

  it('should expose stack trace in development', () => {
    process.env.NODE_ENV = 'development';
    const err = new Error('Unknown error');
    errorHandler(err, mockReq, mockRes, nextFn);
    const callArgs = mockRes.json.mock.calls[0][0];
    expect(callArgs.error.stack).toBeDefined();
    process.env.NODE_ENV = 'test';
  });
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

  it('should generate UUID format request ID', () => {
    const mockReq = { headers: {} };
    const mockRes = { setHeader: jest.fn() };
    const nextFn = jest.fn();
    
    requestId(mockReq, mockRes, nextFn);
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(mockReq.requestId).toMatch(uuidRegex);
  });
});

describe('Pagination Helper', () => {
  it('should calculate correct offset for page 1', () => {
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

  it('should calculate correct offset for page 3', () => {
    const result = paginate('SELECT * FROM users', 3, 20);
    expect(result.page).toBe(3);
    expect(result.perPage).toBe(20);
    expect(result.offset).toBe(40);
  });

  it('should limit perPage to 100', () => {
    const result = paginate('SELECT * FROM users', 1, 200);
    expect(result.perPage).toBe(100);
  });

  it('should default perPage to 20', () => {
    const result = paginate('SELECT * FROM users');
    expect(result.perPage).toBe(20);
  });

  it('should default page to 1', () => {
    const result = paginate('SELECT * FROM users', undefined, 20);
    expect(result.page).toBe(1);
  });

  it('should handle string page values', () => {
    const result = paginate('SELECT * FROM users', '2', '20');
    expect(result.page).toBe(2);
    expect(result.offset).toBe(20);
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

  it('should handle partial last page', () => {
    const data = [{ id: 1 }];
    const response = formatPaginatedResponse(data, 25, 2, 20);
    expect(response.meta.totalPages).toBe(2);
    expect(response.meta.hasNextPage).toBe(false);
    expect(response.meta.hasPrevPage).toBe(true);
  });

  it('should handle single item', () => {
    const data = [{ id: 1 }];
    const response = formatPaginatedResponse(data, 1, 1, 20);
    expect(response.meta.totalPages).toBe(1);
    expect(response.meta.hasNextPage).toBe(false);
    expect(response.meta.hasPrevPage).toBe(false);
  });
});
