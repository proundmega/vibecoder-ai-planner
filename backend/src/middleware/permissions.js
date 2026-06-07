const PermissionService = require('../services/PermissionService');

/**
 * Require the user to have at least ONE of the specified permissions.
 * Usage: requireAnyPermission('TICKET_CREATE', 'USER_CREATE')
 */
function requireAnyPermission(...permissionCodes) {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      if (!userRole) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const hasPerm = await PermissionService.hasAnyPermission(userRole, permissionCodes);
      if (!hasPerm) {
        return res.status(403).json({
          error: 'Forbidden',
          required: permissionCodes,
          actualRole: userRole,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require the user to have ALL specified permissions.
 * Usage: requireAllPermissions('TICKET_UPDATE', 'TICKET_STATUS_CHANGE')
 */
function requireAllPermissions(...permissionCodes) {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      if (!userRole) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const hasPerms = await PermissionService.hasAllPermissions(userRole, permissionCodes);
      if (!hasPerms) {
        return res.status(403).json({
          error: 'Forbidden',
          required: permissionCodes,
          actualRole: userRole,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireAnyPermission, requireAllPermissions };
