const express = require('express');
const router = express.Router();
const PermissionService = require('../services/PermissionService');

/**
 * @openapi
 * /permissions/{roleName}:
 *   get:
 *     tags: [Permissions]
 *     summary: Get permissions for a role
 *     parameters:
 *       - in: path
 *         name: roleName
 *         required: true
 *         schema: { type: string, enum: [user, member, project_admin, super_admin] }
 *     responses:
 *       200:
 *         description: List of permission codes for the role
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { type: string }
 */
router.get('/:roleName', async (req, res, next) => {
  try {
    const permissions = await PermissionService.resolvePermissions(req.params.roleName);
    res.json({ success: true, data: [...permissions] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
