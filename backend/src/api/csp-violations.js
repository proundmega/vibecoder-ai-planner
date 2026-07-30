const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { verifyToken } = require('../middleware/auth');

/**
 * @openapi
 * /v1/csp-violations:
 *   get:
 *     tags: [CSP]
 *     summary: List CSP violations
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: directive
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated list of CSP violations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     violations:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total: { type: integer }
 *                     limit: { type: integer }
 *                     offset: { type: integer }
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const directive = req.query.directive;

    let whereClause = '';
    const params = [];

    if (directive) {
      whereClause = 'WHERE violated_directive = $1';
      params.push(directive);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM csp_violations ${whereClause}`,
      params
    );

    const total = parseInt(countResult.rows[0].count);

    const selectParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT id, violated_directive, blocked_uri, document_uri, referrer, created_at
       FROM csp_violations ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      selectParams
    );

    res.json({
      success: true,
      data: {
        violations: result.rows,
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /v1/csp-violations:
 *   delete:
 *     tags: [CSP]
 *     summary: Clear all CSP violations
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: All violations cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     deletedCount: { type: integer }
 */
router.delete('/', verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM csp_violations');
    res.json({
      success: true,
      data: {
        deletedCount: result.rowCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
