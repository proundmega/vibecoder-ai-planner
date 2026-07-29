const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const providerController = require('../controllers/providerController');
const { addProviderSchema, updateProviderSchema } = require('../validators/providers');
const ProviderService = require('../services/ProviderService');

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
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               labels: { type: array, items: { type: string } }
 *               priority: { type: string }
 *     responses:
 *       200:
 *         description: Resolved provider config
 */
router.post('/resolve', verifyToken, async (req, res, next) => {
  try {
    const ticketInfo = {
      labels: req.body.labels || [],
      priority: req.body.priority || 'medium',
      phase: req.body.phase || 'backlog',
    };
    const projectId = req.body.project_id || null;
    const config = await ProviderService.resolveProvider(ticketInfo, projectId);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
