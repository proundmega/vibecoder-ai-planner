const { requireRole, requireActiveUser } = require('./auth');

describe('requireRole middleware', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should call next() when user has allowed role', () => {
    req = { user: { userId: 1, role: 'project_admin' } };
    const middleware = requireRole('project_admin', 'member');
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should call next() when user matches any of multiple allowed roles', () => {
    req = { user: { userId: 1, role: 'member' } };
    const middleware = requireRole('project_admin', 'member');
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 403 when user has disallowed role', () => {
    req = { user: { userId: 1, role: 'user' } };
    const middleware = requireRole('project_admin', 'member');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      required: ['project_admin', 'member'],
      actual: 'user',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when user object is missing', () => {
    req = {};
    const middleware = requireRole('project_admin');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('should return 401 when user has no role property', () => {
    req = { user: { userId: 1 } };
    const middleware = requireRole('project_admin');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('should allow super_admin when in allowed roles', () => {
    req = { user: { userId: 1, role: 'super_admin' } };
    const middleware = requireRole('super_admin');
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should block super_admin when not in allowed roles', () => {
    req = { user: { userId: 1, role: 'super_admin' } };
    const middleware = requireRole('project_admin', 'member');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireActiveUser middleware', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should call next() when user is active', async () => {
    req = { user: { userId: 1 } };
    const { pool } = require('../db');
    pool.query.mockResolvedValueOnce({ rows: [{ is_active: true }] });
    const middleware = requireActiveUser;
    middleware(req, res, next);
    // Wait for async query to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(next).toHaveBeenCalled();
  });

  it('should return 403 when user object is missing', () => {
    req = {};
    const middleware = requireActiveUser;
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Account deactivated' });
  });
});
