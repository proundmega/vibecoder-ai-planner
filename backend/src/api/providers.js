const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const ProviderService = require('../services/ProviderService');
const { pool } = require('../db');
const { ForbiddenError, ValidationError } = require('../errors/HttpError');

/**
 * @openapi
 * /providers/resolve:
 *   post:
 *     tags: [Providers]
 *     summary: Resolve provider for a ticket
 *     description: Selects a verified registry model by role or phase. Legacy labels/priority routing is not used.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phase: { type: string }
 *               role: { type: string, enum: [worker, reviewer, planner] }
 *               project_id: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Resolved provider config
 *       403:
 *         description: Caller cannot access the requested project
 */
router.post('/resolve', verifyToken, async (req, res, next) => {
  try {
    const rawProjectId = req.body.project_id;
    if (rawProjectId != null && !/^\d+$/.test(String(rawProjectId))) {
      throw new ValidationError('project_id must be a positive integer');
    }
    const projectId = rawProjectId == null ? null : Number(rawProjectId);

    if (projectId != null && req.user.role !== 'super_admin') {
      const access = await pool.query(
        `SELECT 1 FROM projects p
         WHERE p.id = $1
           AND (p.owner_id = $2
                OR ($3 IN ('project_admin','super_admin')
                    AND EXISTS (SELECT 1 FROM project_memberships m
                                WHERE m.project_id = p.id AND m.user_id = $2)))`,
        [projectId, req.user.userId, req.user.role]
      );
      if (access.rows.length === 0) {
        throw new ForbiddenError('Not a member of this project');
      }
    }

    // Model selection is by role/phase; fg-38 owns label/priority routing.
    const ticketInfo = {
      phase: req.body.phase || 'backlog',
      role: req.body.role,
    };
    const config = await ProviderService.resolveProvider(ticketInfo, projectId, req.user.userId);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
