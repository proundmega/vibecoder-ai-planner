const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const billingController = require('../controllers/billingController');

/**
 * @openapi
 * /billing/projects/{id}/billing:
 *   get:
 *     tags: [Billing]
 *     summary: Get billing for a project
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Billing data for project
 */
router.get('/projects/:id/billing', verifyToken, billingController.getProjectBilling);

/**
 * @openapi
 * /billing/users/me/billing:
 *   get:
 *     tags: [Billing]
 *     summary: Get billing for current user
 *     responses:
 *       200:
 *         description: Billing data for user
 */
router.get('/users/me/billing', verifyToken, billingController.getUserBilling);

module.exports = router;
