const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const ApprovalService = require('../services/ApprovalService');

// Create approval request (for AI agents moving to done)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { ticketId } = req.body;
    
    if (!ticketId) {
      return res.status(400).json({ error: 'ticketId is required' });
    }
    
    const approval = await ApprovalService.create(ticketId, req.user.userId);
    res.status(201).json(approval);
  } catch (error) {
    console.error('POST /api/approvals', error);
    res.status(400).json({ error: error.message });
  }
});

// Get pending approvals for current user
router.get('/pending', verifyToken, async (req, res) => {
  try {
    const approvals = await ApprovalService.getPendingByRequester(req.user.userId);
    res.json({ approvals });
  } catch (error) {
    console.error('GET /api/approvals/pending', error);
    res.status(500).json({ error: error.message });
  }
});

// Get approvals for a specific ticket
router.get('/ticket/:ticketId', verifyToken, async (req, res) => {
  try {
    const approvals = await ApprovalService.getByTicketId(req.params.ticketId);
    res.json({ approvals });
  } catch (error) {
    console.error('GET /api/approvals/ticket/:ticketId', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve request (project_admin or member only)
router.post('/:approvalId/approve', verifyToken, requireRole('project_admin', 'member', 'super_admin'), async (req, res) => {
  try {
    const approval = await ApprovalService.approve(
      req.params.approvalId,
      req.user.userId
    );
    
    res.json({
      message: 'Approval request approved',
      approval
    });
  } catch (error) {
    console.error('POST /api/approvals/:approvalId/approve', error);
    res.status(400).json({ error: error.message });
  }
});

// Reject request (project_admin or member only)
router.post('/:approvalId/reject', verifyToken, requireRole('project_admin', 'member', 'super_admin'), async (req, res) => {
  try {
    const approval = await ApprovalService.reject(
      req.params.approvalId,
      req.user.userId
    );
    
    res.json({
      message: 'Approval request rejected',
      approval
    });
  } catch (error) {
    console.error('POST /api/approvals/:approvalId/reject', error);
    res.status(400).json({ error: error.message });
  }
});

// Get all approvals (super_admin only)
router.get('/', verifyToken, requireRole('super_admin'), async (req, res) => {
  try {
    const { status, page = 1, perPage = 20 } = req.query;
    const result = await ApprovalService.getAll({ status, page, perPage });
    res.json(result);
  } catch (error) {
    console.error('GET /api/approvals', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
