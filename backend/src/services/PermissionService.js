const { pool } = require('../db');
const logger = require('../utils/logger');

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

// Load initial cache on startup
const MAX_RETRIES = parseInt(process.env.PERMISSION_INIT_RETRIES) || 3;
const RETRY_DELAY_MS = parseInt(process.env.PERMISSION_INIT_RETRY_DELAY_MS) || 1000;

async function init(retries = MAX_RETRIES) {
  try {
    const result = await pool.query(
      `SELECT r.name FROM roles r ORDER BY r.name`
    );
    for (const row of result.rows) {
      await resolvePermissions(row.name);
    }
  } catch (err) {
    if (retries > 0) {
      logger.warn(`PermissionService.init() failed, retrying (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return init(retries - 1);
    }
    logger.error(`PermissionService.init() failed after ${MAX_RETRIES} retries:`, err);
    throw err;
  }
}

if (process.env.NODE_ENV !== 'test') {
  init().catch(logger.error);
}

module.exports = {
  init,
  resolvePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  clearCache,
};
