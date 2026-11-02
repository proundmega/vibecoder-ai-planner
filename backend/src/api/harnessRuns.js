const express = require('express');
const router = express.Router();
const HarnessRunService = require('../services/HarnessRunService');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const { verifyTokenOrAgent } = require('../middleware/auth');
const { ForbiddenError, NotFoundError } = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Agent-facing durable harness run API (fg-33).
 *
 * Agents persist the run before starting side effects and record a checkpoint
 * after each step. Operators can read run state with a normal JWT, scoped to
 * the ticket's project.
 */

function requireAgent(req) {
  if (!req.agent || !req.agent.id) {
    throw new ForbiddenError('Agent API key required');
  }
  return req.agent.id;
}

async function assertCanReadRun(req, run) {
  if (req.agent) {
    if (String(run.agent_id) !== String(req.agent.id)) {
      throw new ForbiddenError('Harness run belongs to another agent');
    }
    return;
  }

  const role = req.user?.role;
  const userId = req.user?.userId || req.user?.id;
  if (!role || !userId || !(await PermissionService.hasPermission(role, 'AGENT_READ'))) {
    throw new ForbiddenError('Operator permission required');
  }
  if (role === 'super_admin') {
    return;
  }

  const access = await pool.query(
    `SELECT p.owner_id,
            EXISTS (
              SELECT 1 FROM project_memberships pm
              WHERE pm.project_id = p.id AND pm.user_id = $2
            ) AS is_member
     FROM tickets t
     JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1`,
    [run.ticket_id, userId]
  );

  if (access.rows.length === 0) {
    throw new NotFoundError('Ticket not found');
  }

  const { owner_id: ownerId, is_member: isMember } = access.rows[0];
  if (String(ownerId) !== String(userId) && !isMember) {
    throw new ForbiddenError('Not a member of this ticket\u2019s project');
  }
}

router.post('/runs', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const {
      ticketId,
      branch,
      baseSha,
      workspacePath,
      sessionId,
      provider,
      model,
      attempt,
    } = req.body || {};

    const run = await HarnessRunService.startRun({
      ticketId,
      agentId,
      branch,
      baseSha,
      workspacePath,
      sessionId,
      provider,
      model,
      attempt,
    });

    res.status(201).json({ success: true, data: run });
  } catch (error) {
    logger.error('POST /harness/runs failed:', error);
    next(error);
  }
});

router.get('/runs/:runId', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertCanReadRun(req, run);
    res.json({ success: true, data: run });
  } catch (error) {
    logger.error('GET /harness/runs/:runId failed:', error);
    next(error);
  }
});

router.get('/runs/:runId/checkpoints', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertCanReadRun(req, run);
    const checkpoints = await HarnessRunService.getCheckpoints(req.params.runId);
    res.json({ success: true, data: checkpoints });
  } catch (error) {
    logger.error('GET /harness/runs/:runId/checkpoints failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/checkpoints', verifyTokenOrAgent, async (req, res, next) => {
  try {
    requireAgent(req);
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertCanReadRun(req, run);

    const checkpoint = await HarnessRunService.recordCheckpoint(
      req.params.runId,
      req.body?.step,
      req.body?.payload
    );

    res.status(201).json({ success: true, data: checkpoint });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/checkpoints failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/heartbeat', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const run = await HarnessRunService.heartbeat(
      req.params.runId,
      agentId,
      req.body?.step
    );
    res.json({ success: true, data: run });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/heartbeat failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/finish', verifyTokenOrAgent, async (req, res, next) => {
  try {
    requireAgent(req);
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertCanReadRun(req, run);

    const finished = await HarnessRunService.finishRun(req.params.runId, {
      status: req.body?.status,
      error: req.body?.error,
      headSha: req.body?.headSha,
      prUrl: req.body?.prUrl,
    });

    res.json({ success: true, data: finished });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/finish failed:', error);
    next(error);
  }
});

router.get('/tickets/:ticketId/run', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const run = await HarnessRunService.getLatestRunForTicket(req.params.ticketId);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No harness run for this ticket' },
      });
    }
    await assertCanReadRun(req, run);
    res.json({ success: true, data: run });
  } catch (error) {
    logger.error('GET /harness/tickets/:ticketId/run failed:', error);
    next(error);
  }
});

router.post('/leases', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const lease = await HarnessRunService.claimLease({
      ticketId: req.body?.ticketId,
      runId: req.body?.runId,
      agentId,
      ttlSeconds: req.body?.ttlSeconds,
    });

    if (!lease) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Ticket is leased by another run' },
      });
    }

    res.status(201).json({ success: true, data: lease });
  } catch (error) {
    logger.error('POST /harness/leases failed:', error);
    next(error);
  }
});

router.post('/leases/:ticketId/renew', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const lease = await HarnessRunService.renewLease({
      ticketId: req.params.ticketId,
      runId: req.body?.runId,
      agentId,
      ttlSeconds: req.body?.ttlSeconds,
    });

    if (!lease) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Lease is not held by this run' },
      });
    }

    res.json({ success: true, data: lease });
  } catch (error) {
    logger.error('POST /harness/leases/:ticketId/renew failed:', error);
    next(error);
  }
});

router.delete('/leases/:ticketId', verifyTokenOrAgent, async (req, res, next) => {
  try {
    requireAgent(req);
    const runId = req.body?.runId || req.query.runId;
    const run = await HarnessRunService.getRun(runId);
    await assertCanReadRun(req, run);

    const released = await HarnessRunService.releaseLease(req.params.ticketId, runId);
    if (!released) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Lease not found' },
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /harness/leases/:ticketId failed:', error);
    next(error);
  }
});

module.exports = router;
