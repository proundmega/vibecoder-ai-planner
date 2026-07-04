const logger = require('../utils/logger');

describe('errorHandler.js uses logger.error (BP-54)', () => {
  let errorHandler;
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    errorHandler = require('../middleware/errorHandler').errorHandler;
    
    req = {
      requestId: 'test-request-id',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('calls logger.error instead of console.error for AppError', () => {
    const { AppError } = require('../errors/HttpError');
    const err = new AppError('Test error', 500, 'TEST_ERROR');
    
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'Test error'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'TEST_ERROR',
        message: 'Test error',
      },
    });
  });

  it('calls logger.error for JsonWebTokenError', () => {
    const err = new Error('Invalid token');
    err.name = 'JsonWebTokenError';
    
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'Invalid token'
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
    });
  });

  it('calls logger.error for TokenExpiredError', () => {
    const err = new Error('Token expired');
    err.name = 'TokenExpiredError';
    
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'Token expired'
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired',
      },
    });
  });

  it('calls logger.error for duplicate entry error (23505)', () => {
    const err = new Error('duplicate key value');
    err.code = '23505';
    
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'duplicate key value'
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists',
      },
    });
  });

  it('calls logger.error for unknown errors', () => {
    const err = new Error('Something unexpected happened');
    
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'Something unexpected happened'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
  });

  it('does not call console.error', () => {
    const { AppError } = require('../errors/HttpError');
    const err = new AppError('Test', 500, 'TEST');
    
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    errorHandler(err, req, res, next);
    consoleSpy.mockRestore();
    
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
