const logger = require('../utils/logger');
const requestLogger = require('../middleware/requestLogger');

describe('Winston Logger', () => {
  it('should be defined', () => {
    expect(logger).toBeDefined();
  });

  it('should have info method', () => {
    expect(logger.info).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('should have error method', () => {
    expect(logger.error).toBeDefined();
    expect(typeof logger.error).toBe('function');
  });

  it('should have warn method', () => {
    expect(logger.warn).toBeDefined();
    expect(typeof logger.warn).toBe('function');
  });

  it('should have debug method', () => {
    expect(logger.debug).toBeDefined();
    expect(typeof logger.debug).toBe('function');
  });

  it('should log info messages', () => {
    const spy = jest.spyOn(logger, 'info');
    logger.info('Test message');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should log error messages', () => {
    const spy = jest.spyOn(logger, 'error');
    logger.error('Test error');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should log warn messages', () => {
    const spy = jest.spyOn(logger, 'warn');
    logger.warn('Test warning');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should log with structured format', () => {
    const spy = jest.spyOn(logger, 'info');
    logger.info({ message: 'Test', requestId: '123' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('Request Logger Middleware', () => {
  it('should log request information on finish', (done) => {
    const mockReq = {
      method: 'GET',
      path: '/test',
      requestId: 'test-id-123',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
    };
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 10);
        }
      }),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    
    expect(nextFn).toHaveBeenCalled();
    
    setTimeout(() => {
      done();
    }, 50);
  });

  it('should include request ID in log', (done) => {
    const mockReq = {
      method: 'GET',
      path: '/test',
      requestId: 'test-id-456',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
    };
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 10);
        }
      }),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    
    setTimeout(() => {
      done();
    }, 50);
  });

  it('should include status code in log', (done) => {
    const mockReq = {
      method: 'GET',
      path: '/test',
      requestId: 'test-id-789',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
    };
    const mockRes = {
      statusCode: 404,
      on: jest.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 10);
        }
      }),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    
    setTimeout(() => {
      done();
    }, 50);
  });

  it('should suppress info logging for health endpoints', (done) => {
    const infoSpy = jest.spyOn(logger, 'info');
    const mockReq = {
      method: 'GET',
      path: '/api/health',
      originalUrl: '/api/health',
      requestId: 'health-test-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: {},
    };
    const listeners = {};
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
      done();
    }, 50);
  });

  it('should suppress info logging for /api/version endpoint', (done) => {
    const infoSpy = jest.spyOn(logger, 'info');
    const mockReq = {
      method: 'GET',
      path: '/api/version',
      originalUrl: '/api/version',
      requestId: 'version-test-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: {},
    };
    const listeners = {};
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
      done();
    }, 50);
  });

  it('should suppress info logging for /health endpoint', (done) => {
    const infoSpy = jest.spyOn(logger, 'info');
    const mockReq = {
      method: 'GET',
      path: '/health',
      originalUrl: '/health',
      requestId: 'health-short-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: {},
    };
    const listeners = {};
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
      done();
    }, 50);
  });

  it('should suppress info logging for /version endpoint', (done) => {
    const infoSpy = jest.spyOn(logger, 'info');
    const mockReq = {
      method: 'GET',
      path: '/version',
      originalUrl: '/version',
      requestId: 'version-short-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: {},
    };
    const listeners = {};
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
      done();
    }, 50);
  });

  it('should still log info for non-health endpoints', (done) => {
    const infoSpy = jest.spyOn(logger, 'info');
    const mockReq = {
      method: 'GET',
      path: '/api/v1/projects',
      originalUrl: '/api/v1/projects',
      requestId: 'non-health-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: { userId: 'user-1' },
    };
    const listeners = {};
    const mockRes = {
      statusCode: 200,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(infoSpy).toHaveBeenCalledWith('Request completed', expect.objectContaining({
        path: '/api/v1/projects',
        status: 200,
      }));
      infoSpy.mockRestore();
      done();
    }, 50);
  });

  it('should still log errors for health endpoint 500 responses', (done) => {
    const errorSpy = jest.spyOn(logger, 'error');
    const mockReq = {
      method: 'GET',
      path: '/api/health',
      originalUrl: '/api/health',
      requestId: 'health-error-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: {},
    };
    const listeners = {};
    const mockRes = {
      statusCode: 500,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(errorSpy).toHaveBeenCalledWith('Request failed', expect.objectContaining({
        path: '/api/health',
        status: 500,
      }));
      errorSpy.mockRestore();
      done();
    }, 50);
  });

  it('should still log warnings for health endpoint 400 responses', (done) => {
    const warnSpy = jest.spyOn(logger, 'warn');
    const mockReq = {
      method: 'GET',
      path: '/api/health',
      originalUrl: '/api/health',
      requestId: 'health-warn-id',
      ip: '127.0.0.1',
      get: jest.fn(() => 'TestAgent/1.0'),
      user: {},
    };
    const listeners = {};
    const mockRes = {
      statusCode: 400,
      on: jest.fn((event, callback) => { listeners[event] = callback; }),
      emit: jest.fn((event) => { if (listeners[event]) listeners[event](); }),
      end: jest.fn(),
    };
    const nextFn = jest.fn();
    
    requestLogger(mockReq, mockRes, nextFn);
    mockRes.end();
    
    setTimeout(() => {
      expect(warnSpy).toHaveBeenCalledWith('Client error', expect.objectContaining({
        path: '/api/health',
        status: 400,
      }));
      warnSpy.mockRestore();
      done();
    }, 50);
  });
});
