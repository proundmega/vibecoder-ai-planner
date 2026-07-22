const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const billingController = require('../controllers/billingController');
const BillingService = require('../services/BillingService');

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

/**
 * @openapi
 * /billing/aggregate:
 *   post:
 *     tags: [Billing]
 *     summary: Trigger daily billing aggregation
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Aggregation completed
 *       403:
 *         description: Insufficient permissions
 */
router.post('/aggregate', verifyToken, requireAnyPermission('PROJECT_ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { date } = req.body;
    const aggDate = date ? new Date(date) : new Date(Date.now() - 86400000);
    const count = await BillingService.aggregateDailyBilling(aggDate);
    res.json({ success: true, data: { aggregatedDays: count, date: aggDate.toISOString().split('T')[0] } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
