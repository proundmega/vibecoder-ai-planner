const { pool } = require('../db');
const logger = require('../utils/logger');
const {
  get,
  set,
  del,
  scan,
  isRedisAvailable,
} = require('../utils/redis');

// In-memory fallback cache
const permissionCache = new Map();

const PERMISSION_CACHE_TTL = parseInt(process.env.PERMISSION_CACHE_TTL) || 60;

// Track whether init has been attempted
let initPromise = null;
let cacheInitialized = false;

async function ensureInit() {
  if (cacheInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const result = await pool.query(
        `SELECT r.name FROM roles r ORDER BY r.name`
      );
      for (const row of result.rows) {
        await resolvePermissions(row.name);
      }
      cacheInitialized = true;
    } catch (err) {
      logger.warn(`PermissionService init failed: ${err.message}. Will retry on next permission check.`);
      cacheInitialized = false;
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Resolve all permission codes for a given role name.
 * Uses Redis cache with TTL, falls back to in-memory Map.
 */
async function resolvePermissions(roleName) {
  // Check cache first (Redis or in-memory)
  const cached = await getCachedPermissions(roleName);
  if (cached !== null) {
    return cached;
  }

  // Ensure init has run to populate cache
  try {
    await ensureInit();
  } catch (err) {
    // If init fails, continue without cache - will retry next time
  }

  // Check cache again after init
  const reCached = await getCachedPermissions(roleName);
  if (reCached !== null) {
    return reCached;
  }

  // Cache miss - query DB directly (bypass init to avoid duplicate roles query)
  const result = await pool.query(
    `SELECT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN roles r ON r.id = rp.role_id
     WHERE r.name = $1`,
    [roleName]
  );

  const permissions = new Set(result.rows.map(row => row.code));
  await setCachedPermissions(roleName, permissions);
  return permissions;
}

async function getCachedPermissions(roleName) {
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const data = await get(`permcache:${roleName}`);
      if (data) {
        const perms = JSON.parse(data);
        const set = new Set(perms);
        permissionCache.set(roleName, set);
        return set;
      }
    } catch (err) {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  if (permissionCache.has(roleName)) {
    return permissionCache.get(roleName);
  }

  return null;
}

async function setCachedPermissions(roleName, permissions) {
  const data = JSON.stringify([...permissions]);
  
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      await set(`permcache:${roleName}`, data, PERMISSION_CACHE_TTL);
    } catch (err) {
      logger.warn(`Redis cache set failed for ${roleName}: ${err.message}`);
    }
  }

  // In-memory fallback
  permissionCache.set(roleName, permissions);
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
 * Invalidate cache for a specific role.
 */
async function invalidateRoleCache(roleName) {
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      await del(`permcache:${roleName}`);
    } catch (err) {
      logger.warn(`Redis cache invalidation failed for ${roleName}: ${err.message}`);
    }
  }

  // In-memory fallback
  permissionCache.delete(roleName);
}

/**
 * Invalidate all cached permissions.
 */
async function invalidateAll() {
  // Try Redis first
  if (isRedisAvailable()) {
    try {
      const roles = await scan('permcache:*', 100);
      for (const role of roles) {
        await del(role);
      }
    } catch (err) {
      logger.warn(`Redis cache invalidation failed: ${err.message}`);
    }
  }

  // In-memory fallback
  permissionCache.clear();
  cacheInitialized = false;
  initPromise = null;
}

/**
 * Clear the permission cache (call after migrations).
 */
function clearCache() {
  invalidateAll();
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
      // Populate cache directly to avoid duplicate roles query from ensureInit
      const permsResult = await pool.query(
        `SELECT p.code FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN roles r ON r.id = rp.role_id
         WHERE r.name = $1`,
        [row.name]
      );
      const permissions = new Set(permsResult.rows.map(r => r.code));
      permissionCache.set(row.name, permissions);
      await setCachedPermissions(row.name, permissions);
    }
    cacheInitialized = true;
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
  invalidateRoleCache,
  invalidateAll,
};
