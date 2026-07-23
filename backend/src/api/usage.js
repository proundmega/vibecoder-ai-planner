const express = require('express');
const router = express.Router();
const { verifyToken, agentAuth } = require('../middleware/auth');
const usageController = require('../controllers/usageController');
const UsageLogger = require('../services/UsageLogger');

/**
 * @openapi
 * /usage/projects/{id}/usage:
 *   get:
 *     tags: [Usage]
 *     summary: Get usage for a project
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Usage data for project
 */
router.get('/projects/:id/usage', verifyToken, usageController.getProjectUsage);

/**
 * @openapi
 * /usage/users/me/usage:
 *   get:
 *     tags: [Usage]
 *     summary: Get usage for current user
 *     responses:
 *       200:
 *         description: Usage data for user
 */
router.get('/users/me/usage', verifyToken, usageController.getUserUsage);

/**
 * @openapi
 * /usage/pricing/models:
 *   get:
 *     tags: [Usage]
 *     summary: Get model pricing info
 *     responses:
 *       200:
 *         description: Pricing information for all models
 */
router.get('/pricing/models', verifyToken, usageController.getModelPricing);

/**
 * @openapi
 * /usage/agents/{agentId}/usage:
 *   post:
 *     tags: [Usage]
 *     summary: Java agent reports usage after AI call
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider_type, model, tokens_in, tokens_out]
 *             properties:
 *               provider_type: { type: string }
 *               model: { type: string }
 *               tokens_in: { type: integer }
 *               tokens_out: { type: integer }
 *               duration_ms: { type: integer }
 *               ticket_id: { type: integer }
 *               project_id: { type: integer }
 *     responses:
 *       200:
 *         description: Usage recorded
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Agent ID mismatch — agent can only report its own usage
 */
router.post('/agents/:agentId/usage', agentAuth, async (req, res, next) => {
  try {
    // Enforce: agent can only report usage for its own agent ID
    if (String(req.agent.id) !== String(req.params.agentId)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Agents can only report usage for their own agent ID',
        },
      });
    }

    const agentId = req.params.agentId;
    const usage = req.body;

    if (!usage.provider_type || !usage.model || usage.tokens_in == null || usage.tokens_out == null) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Missing required fields: provider_type, model, tokens_in, tokens_out' } });
    }

    await UsageLogger.reportUsage(agentId, usage);
    res.json({ success: true, data: { recorded: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
