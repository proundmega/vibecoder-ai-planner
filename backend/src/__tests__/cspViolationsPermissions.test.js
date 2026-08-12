jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn(async (role, permissions) => {
    if (role === 'super_admin') return true;
    return false;
  }),
}));

const { requireAnyPermission } = require('../middleware/permissions');

describe('requireAnyPermission middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { user: { role: 'user' } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  it('should deny access when user has no permissions', async () => {
    const middleware = requireAnyPermission('CSP_READ');
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      required: ['CSP_READ'],
      actualRole: 'user'
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow access for super_admin', async () => {
    req.user.role = 'super_admin';
    const middleware = requireAnyPermission('CSP_READ');
    await middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should deny access for non-super_admin users', async () => {
    req.user.role = 'project_admin';
    const middleware = requireAnyPermission('CSP_READ');
    await middleware(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
