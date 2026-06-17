const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const usageController = require('../controllers/usageController');

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

module.exports = router;
