const express = require('express');
const router = express.Router();
const { verifyTokenOrAgent } = require('../middleware/auth');
const { forTicketParam, forQueryProject } = require('../middleware/agentProjectScope');
const {
  requireRuntime,
  requireTicketGrant,
  requireQueryProjectGrant,
} = require('../middleware/agentRole');
const FixQueueService = require('../services/FixQueueService');

function requireRuntimeIdentity(req, res, next) {
  if (!req.runtime || !req.runtime.id) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'RUNTIME_REQUIRED',
        message: 'A running agent runtime is required for this fix endpoint',
      },
    });
  }
  return next();
}

// fg-32b1: due fix requests for one project.
router.get(
  '/agents/fix-queue',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forQueryProject(),
  requireQueryProjectGrant('worker'),
  requireRuntimeIdentity,
  async (req, res, next) => {
    try {
      const requests = await FixQueueService.listQueue(req.query.projectId, {
        limit: req.query.limit,
      });
      res.json({ success: true, data: requests });
    } catch (error) {
      next(error);
    }
  }
);

// fg-32b1: atomic claim with a lease. A repeat claim by the same live owner is
// idempotent; another owner's live lease conflicts.
router.post(
  '/tickets/:ticketId/fix/claim',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forTicketParam(),
  requireTicketGrant('worker'),
  requireRuntimeIdentity,
  async (req, res, next) => {
    try {
      const result = await FixQueueService.claim(req.params.ticketId, {
        runtimeId: req.runtime.id,
        leaseSeconds: req.body?.lease_seconds ?? req.body?.leaseSeconds,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// fg-32b1: lease heartbeat for the owning runtime.
router.post(
  '/tickets/:ticketId/fix/renew',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forTicketParam(),
  requireTicketGrant('worker'),
  requireRuntimeIdentity,
  async (req, res, next) => {
    try {
      const request = await FixQueueService.renew(req.params.ticketId, {
        runtimeId: req.runtime.id,
        leaseSeconds: req.body?.lease_seconds ?? req.body?.leaseSeconds,
      });
      res.json({ success: true, data: { request } });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
