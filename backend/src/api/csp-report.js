const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * @openapi
 * /csp-report:
 *   post:
 *     tags: [System]
 *     summary: CSP violation report endpoint
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               'csp-report':
 *                 type: object
 *                 properties:
 *                   'document-uri': { type: string }
 *                   'referrer': { type: string }
 *                   'blocked-uri': { type: string }
 *                   'violated-directive': { type: string }
 *                   'original-policy': { type: string }
 *     responses:
 *       204:
 *         description: Report received
 */
router.post('/csp-report', (req, res) => {
  const report = req.body;
  logger.warn('CSP Violation Report:', JSON.stringify(report, null, 2));
  res.status(204).send();
});

module.exports = router;
