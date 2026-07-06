const { pool } = require('../db');

jest.mock('../db');

describe('PermissionService cache invalidation', () => {
  let pm;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear all module caches to ensure fresh state
    Object.keys(require.cache).forEach(key => {
      if (key.includes('PermissionService') || key.includes('redis')) {
        delete require.cache[key];
      }
    });
    pm = require('../services/PermissionService');
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('invalidateRoleCache', () => {
    it('should be a function', () => {
      expect(typeof pm.invalidateRoleCache).toBe('function');
    });

    it('should not throw for non-existent role', async () => {
      await expect(pm.invalidateRoleCache('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('invalidateAll', () => {
    it('should be a function', () => {
      expect(typeof pm.invalidateAll).toBe('function');
    });

    it('should not throw', async () => {
      await expect(pm.invalidateAll()).resolves.toBeUndefined();
    });
  });

  describe('clearCache', () => {
    it('should be a function', () => {
      expect(typeof pm.clearCache).toBe('function');
    });

    it('should not throw', () => {
      expect(() => pm.clearCache()).not.toThrow();
    });
  });

  describe('hasPermission', () => {
    it('should be a function', () => {
      expect(typeof pm.hasPermission).toBe('function');
    });

    it('should return false when no permissions found', async () => {
      const result = await pm.hasPermission('user', 'TICKET_CREATE');
      expect(result).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('should be a function', () => {
      expect(typeof pm.hasAnyPermission).toBe('function');
    });

    it('should return false when no permissions found', async () => {
      const result = await pm.hasAnyPermission('user', ['TICKET_CREATE', 'TICKET_READ']);
      expect(result).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should be a function', () => {
      expect(typeof pm.hasAllPermissions).toBe('function');
    });

    it('should return true when no permissions needed (empty array)', async () => {
      const result = await pm.hasAllPermissions('user', []);
      expect(result).toBe(true);
    });

    it('should return false when permissions not found', async () => {
      const result = await pm.hasAllPermissions('user', ['TICKET_CREATE']);
      expect(result).toBe(false);
    });
  });
});
