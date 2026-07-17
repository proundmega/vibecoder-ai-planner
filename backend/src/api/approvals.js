const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const ApprovalService = require('../services/ApprovalService');
const { createApprovalSchema } = require('../validators/approvals');
const logger = require('../utils/logger');

/**
 * @openapi
 * /approvals:
 *   post:
 *     tags: [Approvals]
 *     summary: Create approval request
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ticketId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Approval request created
 *       400:
 *         description: Validation error
 */
router.post('/', verifyToken, validate(createApprovalSchema), async (req, res) => {
  try {
    const { ticketId } = req.body;
    const approval = await ApprovalService.create(ticketId, req.user.userId);
    res.status(201).json({ success: true, data: approval });
  } catch (error) {
    logger.error('POST /api/approvals', error);
    res.status(400).json({ error: { message: error.message } });
  }
});

/**
 * @openapi
 * /approvals:
 *   get:
 *     tags: [Approvals]
 *     summary: Get all approvals (super admin only)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: perPage
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of all approvals
 *       403:
 *         description: Forbidden - super admin only
 */
router.get('/', verifyToken, requireAnyPermission('APPROVAL_VIEW'), async (req, res) => {
  try {
    const { status, page = 1, perPage = 20 } = req.query;
    const result = await ApprovalService.getAll({ status, page, perPage });
    res.json(result);
  } catch (error) {
    logger.error('GET /api/approvals', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

/**
 * @openapi
 * /approvals/pending:
 *   get:
 *     tags: [Approvals]
 *     summary: Get pending approvals for current user
 *     responses:
 *       200:
 *         description: List of pending approvals
 */
router.get('/pending', verifyToken, async (req, res) => {
  try {
    const approvals = await ApprovalService.getPendingByRequester(req.user.userId);
    res.json({ success: true, data: approvals });
  } catch (error) {
    logger.error('GET /api/approvals/pending', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

/**
 * @openapi
 * /approvals/ticket/{ticketId}:
 *   get:
 *     tags: [Approvals]
 *     summary: Get approvals for a ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of approvals for ticket
 */
router.get('/ticket/:ticketId', verifyToken, async (req, res) => {
  try {
    const approvals = await ApprovalService.getByTicketId(req.params.ticketId);
    res.json({ success: true, data: approvals });
  } catch (error) {
    logger.error('GET /api/approvals/ticket/:ticketId', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

/**
 * @openapi
 * /approvals/{approvalId}/approve:
 *   post:
 *     tags: [Approvals]
 *     summary: Approve request
 *     parameters:
 *       - in: path
 *         name: approvalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Approval approved
 *       400:
 *         description: Approval failed
 */
router.post('/:approvalId/approve', verifyToken, requireAnyPermission('APPROVAL_APPROVE'), async (req, res) => {
  try {
    const approval = await ApprovalService.approve(req.params.approvalId, req.user.userId);
    res.json({ success: true, data: approval, message: 'Approval request approved' });
  } catch (error) {
    logger.error('POST /api/approvals/:approvalId/approve', error);
    res.status(400).json({ error: { message: error.message } });
  }
});

/**
 * @openapi
 * /approvals/{approvalId}/reject:
 *   post:
 *     tags: [Approvals]
 *     summary: Reject request
 *     parameters:
 *       - in: path
 *         name: approvalId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Approval rejected
 *       400:
 *         description: Rejection failed
 */
router.post('/:approvalId/reject', verifyToken, requireAnyPermission('APPROVAL_REJECT'), async (req, res) => {
  try {
    const approval = await ApprovalService.reject(req.params.approvalId, req.user.userId);
    res.json({ success: true, data: approval, message: 'Approval request rejected' });
  } catch (error) {
    logger.error('POST /api/approvals/:approvalId/reject', error);
    res.status(400).json({ error: { message: error.message } });
  }
});

module.exports = router;
