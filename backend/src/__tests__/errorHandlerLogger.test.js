const { AppError, ValidationError } = require('../errors/HttpError');
const { errorHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

describe('errorHandler.js uses logger.error (BP-54)', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { requestId: 'test-request-id' };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('calls logger.error instead of console.error for AppError', () => {
    const err = new AppError('Test error', 500, 'TEST_ERROR');
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'Test error'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'TEST_ERROR', message: 'Test error' },
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
  });

  it('calls logger.error for unknown errors', () => {
    const err = new Error('Something unexpected happened');
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith(
      '[ERROR] Request test-request-id:',
      'Something unexpected happened'
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('does not call console.error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = new AppError('Test', 500, 'TEST');
    errorHandler(err, req, res, next);
    consoleSpy.mockRestore();
    
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('calls logger.error for development stack traces', () => {
    process.env.NODE_ENV = 'development';
    const err = new Error('Dev error');
    err.stack = 'Error: Dev error\n    at test.js:1';
    errorHandler(err, req, res, next);
    
    expect(logger.error).toHaveBeenCalledWith('[ERROR] Request test-request-id:', 'Dev error');
    expect(logger.error).toHaveBeenCalledWith(err.stack);
    process.env.NODE_ENV = 'test';
  });
});
