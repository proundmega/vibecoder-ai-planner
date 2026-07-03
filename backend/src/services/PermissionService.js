const { pool } = require('../db');

// In-memory cache: role_name -> Set of permission codes
const permissionCache = new Map();

/**
 * Resolve all permission codes for a given role name.
 * Cached after first call per role.
 */
async function resolvePermissions(roleName) {
  if (permissionCache.has(roleName)) {
    return permissionCache.get(roleName);
  }

  const result = await pool.query(
    `SELECT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN roles r ON r.id = rp.role_id
     WHERE r.name = $1`,
    [roleName]
  );

  const permissions = new Set(result.rows.map(row => row.code));
  permissionCache.set(roleName, permissions);
  return permissions;
}

/**
 * Check if a user (by role name) has a specific permission.
 */
async function hasPermission(roleName, permissionCode) {
  const permissions = await resolvePermissions(roleName);
  return permissions.has(permissionCode);
}

/**
 * Check if a user has ANY of the given permissions.
 */
async function hasAnyPermission(roleName, permissionCodes) {
  const permissions = await resolvePermissions(roleName);
  return permissionCodes.some(code => permissions.has(code));
}

/**
 * Check if a user has ALL of the given permissions.
 */
async function hasAllPermissions(roleName, permissionCodes) {
  const permissions = await resolvePermissions(roleName);
  return permissionCodes.every(code => permissions.has(code));
}

/**
 * Clear the permission cache (call after migrations).
 */
function clearCache() {
  permissionCache.clear();
}

// Load initial cache on startup with retry
let initPromise = null;

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const result = await pool.query(
        `SELECT r.name FROM roles r ORDER BY r.name`
      );
      for (const row of result.rows) {
        await resolvePermissions(row.name);
      }
    } catch (err) {
      console.error('PermissionService init failed, will retry on first request:', err.message);
      initPromise = null;
      throw err;
    }
  })();
  return initPromise;
}

init().catch((err) => {
  console.error('PermissionService init failed at startup:', err.message);
});

// Wrap resolvePermissions to auto-retry init on first call if cache is empty
const originalResolvePermissions = resolvePermissions;
async function resolvePermissionsWithRetry(roleName) {
  if (!permissionCache.has(roleName)) {
    try {
      await init();
    } catch {
      // init failed, will retry on next call
    }
  }
  return originalResolvePermissions(roleName);
}

module.exports = {
  resolvePermissions: resolvePermissionsWithRetry,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  clearCache,
};
