const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { pool } = require('../db');

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
router.post('/csp-report', async (req, res) => {
  const report = req.body['csp-report'] || req.body;
  logger.warn('CSP Violation Report:', JSON.stringify(report, null, 2));
  const hasDirective = report['violated-directive'] || report.violated_directive;
  const hasBlockedUri = report['blocked-uri'] || report.blocked_uri;
  if (!report || (!hasDirective && !hasBlockedUri)) {
    res.status(204).send();
    return;
  }
  try {
    await pool.query(
      'INSERT INTO csp_violations (violated_directive, blocked_uri, document_uri, referrer, original_policy) VALUES ($1, $2, $3, $4, $5)',
      [
        report['violated-directive'] || report.violated_directive || null,
        report['blocked-uri'] || report.blocked_uri || null,
        report['document-uri'] || report.document_uri || null,
        report.referrer || null,
        report['original-policy'] || report.original_policy || null,
      ]
    );
  } catch (err) {
    logger.error('Failed to store CSP violation:', err.message);
  }
  res.status(204).send();
});

module.exports = router;
