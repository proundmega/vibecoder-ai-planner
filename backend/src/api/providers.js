const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const providerController = require('../controllers/providerController');
const { addProviderSchema, updateProviderSchema } = require('../validators/providers');
const { providerCatalog } = require('../utils/providerDefaults');
const ProviderService = require('../services/ProviderService');
const { pool } = require('../db');
const { ForbiddenError, ValidationError } = require('../errors/HttpError');

/**
 * @openapi
 * /providers:
 *   get:
 *     tags: [Providers]
 *     summary: List all providers
 *     responses:
 *       200:
 *         description: List of providers
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { project_id } = req.query;
    const providers = await providerController.listProviders(project_id || null);
    res.json({ success: true, data: providers });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /providers:
 *   post:
 *     tags: [Providers]
 *     summary: Add a new provider
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               providerType: { type: string }
 *               apiKey: { type: string }
 *     responses:
 *       201:
 *         description: Provider created
 */
router.post('/', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(addProviderSchema), providerController.addProvider);

// Deprecation stubs for old per-project routes — must come before :/id routes
const deprecatedRoute = (req, res) => {
  res.status(410).json({
    success: false,
    error: { code: 'DEPRECATED', message: 'Providers are now global. Use /api/v1/providers instead.' }
  });
};

router.use('/projects/:projectId/provider', deprecatedRoute);
router.use('/projects/:projectId/providers', deprecatedRoute);
router.use('/projects/:projectId/providers/', deprecatedRoute);

/**
 * @openapi
 * /providers/defaults:
 *   get:
 *     tags: [Providers]
 *     summary: List built-in provider defaults
 *     responses:
 *       200:
 *         description: Provider type catalog with default endpoints and model rules
 */
router.get('/defaults', verifyToken, (req, res) => {
  res.json({ success: true, data: providerCatalog() });
});

/**
 * @openapi
 * /providers/{id}:
 *   get:
 *     tags: [Providers]
 *     summary: Get a provider by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Provider details
 */
router.get('/:id', verifyToken, providerController.getProvider);

/**
 * @openapi
 * /providers/{id}:
 *   patch:
 *     tags: [Providers]
 *     summary: Update a provider
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Provider updated
 */
router.patch('/:id', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(updateProviderSchema), providerController.updateProvider);

/**
 * @openapi
 * /providers/{id}:
 *   delete:
 *     tags: [Providers]
 *     summary: Delete a provider
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Provider deleted
 */
router.delete('/:id', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), providerController.deleteProvider);

/**
 * @openapi
 * /providers/{id}/test:
 *   post:
 *     tags: [Providers]
 *     summary: Test provider connection
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Connection test result
 */
router.post('/:id/test', verifyToken, providerController.testProvider);

/**
 * @openapi
 * /providers/{id}/directorship:
 *   patch:
 *     tags: [Providers]
 *     summary: Set provider as director
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Directorship updated
 */
router.patch('/:id/directorship', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), providerController.setDirector);

/**
 * @openapi
 * /providers/{id}/agents:
 *   get:
 *     tags: [Providers]
 *     summary: Get agents for a provider
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of agents
 */
router.get('/:id/agents', verifyToken, providerController.getProviderAgents);

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
