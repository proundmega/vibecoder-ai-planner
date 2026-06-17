const { apiVersion } = require('../middleware/apiVersion');

describe('API Version Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = {
      setHeader: jest.fn(),
    };
    next = jest.fn();
  });

  it('should set req.apiVersion to the specified version', () => {
    const middleware = apiVersion('v1');
    middleware(req, res, next);
    
    expect(req.apiVersion).toBe('v1');
  });

  it('should default to v1', () => {
    const middleware = apiVersion();
    middleware(req, res, next);
    
    expect(req.apiVersion).toBe('v1');
  });

  it('should add deprecation header for non-latest versions', () => {
    const middleware = apiVersion('v0');
    middleware(req, res, next);
    
    expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    expect(res.setHeader).toHaveBeenCalledWith('Sunset', '2026-12-31');
  });

  it('should not add deprecation header for latest version', () => {
    const middleware = apiVersion('v1');
    middleware(req, res, next);
    
    expect(res.setHeader).not.toHaveBeenCalledWith('Deprecation', 'true');
    expect(res.setHeader).not.toHaveBeenCalledWith('Sunset', '2026-12-31');
  });

  it('should call next()', () => {
    const middleware = apiVersion('v1');
    middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
  });
});
