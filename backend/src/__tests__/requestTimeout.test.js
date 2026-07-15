const { requestTimeout } = require('../middleware/requestTimeout');

describe('Request Timeout Middleware', () => {
  let req, res, next;
  let originalSetTimeout;
  let timeoutCallback;

  beforeEach(() => {
    originalSetTimeout = global.setTimeout;
    req = {
      destroy: jest.fn(),
    };
    res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn((event, cb) => {
        if (event === 'finish') cb();
      }),
    };
    next = jest.fn();
    
    // Mock setTimeout to capture the callback
    global.setTimeout = jest.fn((cb, _ms) => {
      timeoutCallback = cb;
      return 1;
    });
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
  });

  it('should call next() immediately', () => {
    const middleware = requestTimeout(30000);
    middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
  });

  it('should return 408 after timeout', () => {
    const middleware = requestTimeout(1000);
    middleware(req, res, next);
    
    // Trigger the timeout callback
    timeoutCallback();
    
    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'REQUEST_TIMEOUT',
        message: 'Request timed out after 1000ms',
      },
    });
  });

  it('should destroy request after timeout', () => {
    const middleware = requestTimeout(1000);
    middleware(req, res, next);
    
    // Trigger the timeout callback
    timeoutCallback();
    
    expect(req.destroy).toHaveBeenCalled();
  });

  it('should not timeout if response is sent before timeout', () => {
    const middleware = requestTimeout(1000);
    middleware(req, res, next);
    
    // Simulate response being sent before timeout
    res.headersSent = true;
    
    // Trigger the timeout callback
    timeoutCallback();
    
    // Should not call status/json if headers already sent
    expect(res.status).not.toHaveBeenCalled();
    expect(req.destroy).not.toHaveBeenCalled();
  });

  it('should use default timeout of 30000ms', () => {
    const middleware = requestTimeout();
    middleware(req, res, next);
    
    // Trigger the timeout callback
    timeoutCallback();
    
    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        message: 'Request timed out after 30000ms',
      }),
    }));
  });
});

describe('Slow Request Logger', () => {
  let req, res, next;
  let loggerModule;
  let originalDateNow;
  let mockDate = 1000;

  beforeEach(() => {
    jest.resetModules();
    loggerModule = require('../utils/logger');
    if (!loggerModule.warn || typeof loggerModule.warn !== 'function') {
      loggerModule.warn = jest.fn();
    }
    originalDateNow = global.Date.now;
    global.Date.now = jest.fn(() => mockDate);
    req = { method: 'GET', path: '/test' };
    res = {
      on: jest.fn((event, cb) => {
        if (event === 'finish') cb();
      }),
    };
    next = jest.fn();
  });

  afterEach(() => {
    global.Date.now = originalDateNow;
  });

  it('should call next()', () => {
    const { slowRequestLogger } = require('../middleware/slowRequest');
    const middleware = slowRequestLogger(5000);
    middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
  });

  it('should log slow requests', () => {
    const { slowRequestLogger } = require('../middleware/slowRequest');
    const middleware = slowRequestLogger(100);
    middleware(req, res, next);
    
    // Simulate slow request
    mockDate = 1200;
    
    // Trigger finish event
    res.on.mock.calls[0][1]();
    
    expect(loggerModule.warn).toHaveBeenCalledWith(
      expect.stringContaining('Slow request: GET /test')
    );
    expect(loggerModule.warn).toHaveBeenCalledWith(
      expect.stringContaining('took 200ms')
    );
  });

  it('should not log fast requests', () => {
    const { slowRequestLogger } = require('../middleware/slowRequest');
    const middleware = slowRequestLogger(5000);
    middleware(req, res, next);
    
    // Trigger finish event immediately
    res.on.mock.calls[0][1]();
    
    expect(loggerModule.warn).not.toHaveBeenCalled();
  });

  it('should use "unmatched" label for 404 requests (no req.route)', async () => {
    const { slowRequestLogger } = require('../middleware/slowRequest');
    const { register } = require('../metrics');
    
    const reqNoRoute = {
      method: 'GET',
      path: '/api/nonexistent-uuid-1234-5678-9abc-def012345678',
      originalUrl: '/api/nonexistent-uuid-1234-5678-9abc-def012345678',
    };
    const resFinish = {
      on: jest.fn((event, cb) => {
        if (event === 'finish') cb();
      }),
      statusCode: 404,
    };
    const middleware = slowRequestLogger(5000);
    middleware(reqNoRoute, resFinish, jest.fn());
    
    const metricsOutput = await register.metrics();
    
    expect(metricsOutput).toContain('path="unmatched"');
    expect(metricsOutput).not.toContain('nonexistent-uuid');
  });

  
});
