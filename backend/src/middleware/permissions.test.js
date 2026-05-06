/**
 * TKT-006: Roles and Permissions Middleware
 * Status: In Progress → ✅ Complete
 * Priority: Medium  
 * Dependencies: TKT-001, TKT-002
 * Blocks: TKT-010, TKT-012
 */

const permissions = require('./permissions');

describe('Permissions Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('hasPermission', () => {
    it('should pass when user has required permissions', () => {
      const mockReq = { user: { role: 'admin' } };
      const mockNext = jest.fn();
      const hasPermission = permissions.hasPermission([]);
      
      hasPermission(mockReq, {}, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject when user is not authenticated', () => {
      const mockReq = { user: undefined };
      const mockRes = { status: jest.fn().json };
      
      permissions.hasPermission([])(mockReq, mockRes, jest.fn());
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject when user lacks required permissions', () => {
      const mockReq = { user: { role: 'viewer' } };
      const mockRes = { status: jest.fn().json };
      
      permissions.hasPermission([permissions.PERMISSIONS.CREATE_TICKET])(mockReq, mockRes, jest.fn());
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should grant permissions for admin role', () => {
      const mockReq = { user: { role: 'admin' } };
      const mockNext = jest.fn();
      
      permissions.hasPermission(permissions.PERMISSIONS.CREATE_TICKET)(mockReq, {}, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should grant permissions for member role', () => {
      const mockReq = { user: { role: 'member' } };
      const mockNext = jest.fn();
      
      permissions.hasPermission(permissions.PERMISSIONS.CHANGE_STATUS)(mockReq, {}, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('isAdmin', () => {
    it('should pass for admin users', () => {
      const mockReq = { user: { role: 'admin' } };
      const mockNext = jest.fn();
      
      permissions.isAdmin(mockReq, {}, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject for non-admin', () => {
      const mockReq = { user: { role: 'viewer' } };
      const mockRes = { status: jest.fn().json };
      
      permissions.isAdmin(mockReq, mockRes, jest.fn());
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('Role Constants', () => {
    it('should define user roles', () => {
      expect(permissions.ROLES.ADMIN).toBe('admin');
      expect(permissions.ROLES.MEMBER).toBe('member');
      expect(permissions.ROLES.VIEWER).toBe('viewer');
    });

    it('should include all permission constants', () => {
      expect(permissions.PERMISSIONS.CREATE_TICKET).toBeDefined();
      expect(permissions.PERMISSIONS.UPDATE_TICKET).toBeDefined();
      expect(permissions.PERMISSIONS.DELETE_TICKET).toBeDefined();
      expect(permissions.PERMISSIONS.CHANGE_STATUS).toBeDefined();
    });
  });

  describe('Permission Mapping', () => {
    it('should map admin role to all permissions', () => {
      const adminPermissions = permissions.ROLE_PERMISSIONS['admin'];
      expect(adminPermissions).toHaveLength(Object.values(permissions.PERMISSIONS).length);
    });

    it('should map member role to limited permissions', () => {
      const memberPermissions = permissions.ROLE_PERMISSIONS['member'];
      expect(memberPermissions).not.toContain(permissions.PERMISSIONS.DELETE_PROJECT);
    });

    it('should map viewer role to minimal permissions', () => {
      const viewerPermissions = permissions.ROLE_PERMISSIONS['viewer'];
      expect(viewerPermissions).toHaveLength(1);
      expect(viewerPermissions[0]).toBe(permissions.PERMISSIONS.VIEW_USERS);
    });
  });
});