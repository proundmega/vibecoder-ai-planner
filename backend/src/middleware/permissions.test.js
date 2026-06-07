/**
 * Permission Middleware Tests
 * Tests for requireAnyPermission and requireAllPermissions middleware
 */

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn(),
  hasAllPermissions: jest.fn(),
}));

const { requireAnyPermission, requireAllPermissions } = require('./permissions');
const PermissionService = require('../services/PermissionService');

describe('Permission Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { user: { role: 'project_admin' } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe('requireAnyPermission', () => {
    it('should call next() when user has at least one matching permission', async () => {
      PermissionService.hasAnyPermission.mockResolvedValue(true);
      
      const middleware = requireAnyPermission('TICKET_CREATE', 'USER_CREATE');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user has no matching permissions', async () => {
      PermissionService.hasAnyPermission.mockResolvedValue(false);
      
      const middleware = requireAnyPermission('TICKET_CREATE', 'USER_CREATE');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        required: ['TICKET_CREATE', 'USER_CREATE'],
        actualRole: 'project_admin',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user has no role', async () => {
      req.user = {};
      
      const middleware = requireAnyPermission('TICKET_CREATE');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    it('should handle PermissionService errors', async () => {
      PermissionService.hasAnyPermission.mockRejectedValue(new Error('DB error'));
      
      const middleware = requireAnyPermission('TICKET_CREATE');
      const nextError = jest.fn();
      await middleware(req, res, nextError);

      expect(nextError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('requireAllPermissions', () => {
    it('should call next() when user has all required permissions', async () => {
      PermissionService.hasAllPermissions.mockResolvedValue(true);
      
      const middleware = requireAllPermissions('TICKET_CREATE', 'TICKET_UPDATE');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user is missing any permission', async () => {
      PermissionService.hasAllPermissions.mockResolvedValue(false);
      
      const middleware = requireAllPermissions('TICKET_CREATE', 'TICKET_UPDATE');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        required: ['TICKET_CREATE', 'TICKET_UPDATE'],
        actualRole: 'project_admin',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user has no role', async () => {
      req.user = {};
      
      const middleware = requireAllPermissions('TICKET_CREATE');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });
  });

  describe('PermissionService calls', () => {
    it('should pass correct role and permission codes to hasAnyPermission', async () => {
      PermissionService.hasAnyPermission.mockResolvedValue(true);
      
      const middleware = requireAnyPermission('PROJECT_DELETE', 'USER_DELETE');
      req.user.role = 'member';
      await middleware(req, res, next);

      expect(PermissionService.hasAnyPermission).toHaveBeenCalledWith('member', ['PROJECT_DELETE', 'USER_DELETE']);
    });

    it('should pass correct role and permission codes to hasAllPermissions', async () => {
      PermissionService.hasAllPermissions.mockResolvedValue(true);
      
      const middleware = requireAllPermissions('TICKET_CREATE', 'TICKET_DELETE');
      req.user.role = 'super_admin';
      await middleware(req, res, next);

      expect(PermissionService.hasAllPermissions).toHaveBeenCalledWith('super_admin', ['TICKET_CREATE', 'TICKET_DELETE']);
    });
  });
});
