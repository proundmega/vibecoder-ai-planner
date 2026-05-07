/**
 * TKT-006: Roles and Permissions Middleware
 * Status: ✅ Complete
 * Tests: All passing
 */

const permissions = require('./permissions');

describe('Permissions Middleware', () => {
  describe('PERMISSIONS constants', () => {
    it('should define all permission strings', () => {
      expect(permissions.PERMISSIONS.ADMIN).toBe('admin');
      expect(permissions.PERMISSIONS.MEMBER).toBe('member');
      expect(permissions.PERMISSIONS.VIEWER).toBe('viewer');
      expect(permissions.PERMISSIONS.USER).toBe('user');
      expect(permissions.PERMISSIONS.CREATE_PROJECT).toBe('create_project');
      expect(permissions.PERMISSIONS.UPDATE_PROJECT).toBe('update_project');
      expect(permissions.PERMISSIONS.DELETE_PROJECT).toBe('delete_project');
      expect(permissions.PERMISSIONS.CREATE_TICKET).toBe('create_ticket');
      expect(permissions.PERMISSIONS.UPDATE_TICKET).toBe('update_ticket');
      expect(permissions.PERMISSIONS.DELETE_TICKET).toBe('delete_ticket');
    });
  });

  describe('hasPermission', () => {
    it('should return true for ADMIN', () => {
      const user = { role: 'admin' };
      expect(permissions.hasPermission(user, 'anything')).toBe(true);
    });

    it('should return true if admin has specific permission', () => {
      const user = { 
        role: 'admin',
        permissions: ['create_project', 'update_project', 'delete_project', 'create_ticket']
      };
      expect(permissions.hasPermission(user, 'create_project')).toBe(true);
      expect(permissions.hasPermission(user, 'delete_project')).toBe(true);
      expect(permissions.hasPermission(user, 'update_ticket')).toBe(true);
    });

    it('should return false for non-admin without permission', () => {
      const user = {
        role: 'member',
        permissions: ['create_project', 'update_project', 'create_ticket']
      };
      expect(permissions.hasPermission(user, 'admin')).toBe(false);
      expect(permissions.hasPermission(user, 'delete_project')).toBe(false);
      expect(permissions.hasPermission(user, 'delete_ticket')).toBe(false);
    });

    it('should return false for user without permission', () => {
      const user = {
        role: 'viewer',
        permissions: ['view_project']
      };
      expect(permissions.hasPermission(user, 'create_ticket')).toBe(false);
    });

    it('should return false when user is null', () => {
      expect(permissions.hasPermission(null, 'anything')).toBe(false);
    });

    it('should return false when user is undefined', () => {
      expect(permissions.hasPermission(undefined, 'anything')).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should return true for admin users', () => {
      const user = { role: 'admin' };
      expect(permissions.isAdmin(user)).toBe(true);
    });

    it('should return false for non-admin users', () => {
      expect(permissions.isAdmin({ role: 'member' })).toBe(false);
      expect(permissions.isAdmin({ role: 'viewer' })).toBe(false);
      expect(permissions.isAdmin(null)).toBe(false);
      expect(permissions.isAdmin(undefined)).toBe(false);
    });
  });

  describe('isMember', () => {
    it('should return true when user is in project members', () => {
      const user = {
        id: 1,
        member_project_ids: [1, 2, 3]
      };
      expect(permissions.isMember(user, 1)).toBe(true);
      expect(permissions.isMember(user, 2)).toBe(true);
      expect(permissions.isMember(user, 100)).toBe(false);
    });

    it('should return false when user is not in project', () => {
      const user = {
        id: 1,
        member_project_ids: []
      };
      expect(permissions.isMember(user, 1)).toBe(false);
    });

    it('should return false when user is null', () => {
      expect(permissions.isMember(null, 1)).toBe(false);
    });
  });

  describe('isProjectOwner', () => {
    it('should return true when user is project owner', () => {
      const user = { id: 1 };
      const project = { owner_id: 1 };
      expect(permissions.isProjectOwner(user, project)).toBe(true);
    });

    it('should return false when user is not owner', () => {
      const user = { id: 2 };
      const project = { owner_id: 1 };
      expect(permissions.isProjectOwner(user, project)).toBe(false);
    });

    it('should return false when project is null', () => {
      const user = { id: 1 };
      expect(permissions.isProjectOwner(user, null)).toBe(false);
    });

    it('should return false when user is null', () => {
      const project = { owner_id: 1 };
      expect(permissions.isProjectOwner(null, project)).toBe(false);
    });
  });

  describe('isResourceOwner', () => {
    it('should return true when user is resource owner', () => {
      const user = { id: 1 };
      const resource = { owner_id: 1 };
      expect(permissions.isResourceOwner(user, resource)).toBe(true);
    });

    it('should return false when user is not owner', () => {
      const user = { id: 2 };
      const resource = { owner_id: 1 };
      expect(permissions.isResourceOwner(user, resource)).toBe(false);
    });

    it('should return false when resource is null', () => {
      const user = { id: 1 };
      expect(permissions.isResourceOwner(user, null)).toBe(false);
    });
  });

  describe('exports', () => {
    it('should export all required functions', () => {
      expect(typeof permissions.hasPermission).toBe('function');
      expect(typeof permissions.isAdmin).toBe('function');
      expect(typeof permissions.isMember).toBe('function');
      expect(typeof permissions.isProjectOwner).toBe('function');
      expect(typeof permissions.isResourceOwner).toBe('function');
    });

    it('should export PERMISSIONS constants', () => {
      expect(Object.keys(permissions.PERMISSIONS)).toHaveLength(15);
    });
  });
});
