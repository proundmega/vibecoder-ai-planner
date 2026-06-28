const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const providerController = require('../controllers/providerController');
const { addProviderSchema, updateProviderSchema } = require('../validators/providers');
const providerService = require('../services/ProviderService');

/**
 * @openapi
 * /providers/{projectId}/providers:
 *   get:
 *     tags: [Providers]
 *     summary: List providers for project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of providers
 */
router.get('/:projectId/providers', verifyToken, providerController.listProviders);

/**
 * @openapi
 * /providers/{projectId}/providers:
 *   post:
 *     tags: [Providers]
 *     summary: Add provider to project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               provider: { type: string }
 *               apiKey: { type: string }
 *     responses:
 *       201:
 *         description: Provider added
 */
router.post('/:projectId/providers', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(addProviderSchema), providerController.addProvider);

/**
 * @openapi
 * /providers/{projectId}/providers/{providerId}:
 *   patch:
 *     tags: [Providers]
 *     summary: Update provider
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               apiKey: { type: string }
 *     responses:
 *       200:
 *         description: Provider updated
 */
router.patch('/:projectId/providers/:providerId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(updateProviderSchema), providerController.updateProvider);

/**
 * @openapi
 * /providers/{projectId}/providers/{providerId}:
 *   delete:
 *     tags: [Providers]
 *     summary: Delete provider
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Provider deleted
 */
router.delete('/:projectId/providers/:providerId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), providerController.deleteProvider);

/**
 * @openapi
 * /providers/{projectId}/providers/{providerId}/test:
 *   post:
 *     tags: [Providers]
 *     summary: Test provider connection
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Connection test result
 */
router.post('/:projectId/providers/:providerId/test', verifyToken, providerController.testProvider);

/**
 * @openapi
 * /providers/projects/{projectId}/provider:
 *   get:
 *     tags: [Providers]
 *     summary: Get project provider config
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Provider config
 */
router.get('/projects/:projectId/provider', verifyToken, async (req, res, next) => {
  try {
    const config = await providerService.getConfig(req.params.projectId);
    res.json({ success: true, data: config || null });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /providers/projects/{projectId}/provider:
 *   put:
 *     tags: [Providers]
 *     summary: Set project provider config
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, model]
 *             properties:
 *               provider: { type: string }
 *               endpoint_url: { type: string }
 *               model: { type: string }
 *               api_key_credential_id: { type: string, format: uuid }
 *               fallback_provider: { type: string }
 *     responses:
 *       200:
 *         description: Provider config saved
 */
router.put('/projects/:projectId/provider', verifyToken, async (req, res, next) => {
  try {
    const config = await providerService.setConfig(req.params.projectId, req.body);
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /providers/projects/{projectId}/provider:
 *   delete:
 *     tags: [Providers]
 *     summary: Delete project provider config
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Provider config deleted
 */
router.delete('/projects/:projectId/provider', verifyToken, async (req, res, next) => {
  try {
    await providerService.deleteConfig(req.params.projectId);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /providers/projects/{projectId}/provider/test:
 *   post:
 *     tags: [Providers]
 *     summary: Test provider connection
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint_url: { type: string }
 *               model: { type: string }
 *               api_key: { type: string }
 *     responses:
 *       200:
 *         description: Connection test result
 */
router.post('/projects/:projectId/provider/test', verifyToken, async (req, res, next) => {
  try {
    const result = await providerService.testConnection(req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
