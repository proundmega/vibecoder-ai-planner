const express = require('express');
const router = express.Router();
const PermissionService = require('../services/PermissionService');

// GET /api/permissions/:roleName -> [permissionCodes]
router.get('/:roleName', async (req, res, next) => {
  try {
    const permissions = await PermissionService.resolvePermissions(req.params.roleName);
    res.json({ success: true, data: [...permissions] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
