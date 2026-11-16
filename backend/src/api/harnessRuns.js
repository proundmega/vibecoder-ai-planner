const express = require('express');
const router = express.Router();
const HarnessRunService = require('../services/HarnessRunService');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessAuditService = require('../services/HarnessAuditService');
const HarnessUsageService = require('../services/HarnessUsageService');
const HarnessEventService = require('../services/HarnessEventService');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const { verifyTokenOrAgent } = require('../middleware/auth');
const { ForbiddenError, NotFoundError, ConflictError } = require('../errors/HttpError');
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

const OPERATOR_ROLES = new Set(['super_admin', 'project_admin', 'member']);

async function assertProjectAccess(run, userId) {
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
    throw new ForbiddenError('Not a member of this ticket’s project');
  }
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
  if (
    !role ||
    !userId ||
    !OPERATOR_ROLES.has(role) ||
    !(await PermissionService.hasPermission(role, 'AGENT_READ'))
  ) {
    throw new ForbiddenError('Operator permission required');
  }
  if (role === 'super_admin') {
    return;
  }

  await assertProjectAccess(run, userId);
}

/**
 * @openapi
 * /harness/runs:
 *   post:
 *     tags: [Harness]
 *     summary: Start a durable harness run for an assigned agent ticket
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ticketId, branch]
 *             properties:
 *               ticketId: { $ref: '#/components/schemas/NumericId' }
 *               branch: { type: string }
 *               baseSha: { type: string, nullable: true }
 *               workspacePath: { type: string, nullable: true }
 *               sessionId: { type: string, nullable: true }
 *               provider: { type: string, nullable: true }
 *               model: { type: string, nullable: true }
 *               attempt: { type: integer, minimum: 1 }
 *               repoProfileId: { type: string, pattern: '^[0-9a-fA-F-]{36}$', nullable: true }
 *               repoProfileVersion: { type: integer, minimum: 1, nullable: true }
 *     responses:
 *       201:
 *         description: Harness run created
 *       409:
 *         description: Incomplete dependencies, an active run, or published work already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
      repoProfileId,
      repoProfileVersion,
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
      repoProfileId,
      repoProfileVersion,
    });

    // The supervisor needs the budget/routing policy before it creates the
    // session. A policy read failure must not undo an accepted run; the agent
    // then falls back to local defaults and still enforces hard limits.
    let budgetPolicy = null;
    try {
      budgetPolicy = await HarnessBudgetService.getPolicy(run.project_id, {
        ticketId: run.ticket_id,
        agentId,
        extraModels: run.model ? [run.model] : [],
      });
      budgetPolicy = {
        ...budgetPolicy,
        reservedCostUsd: Number(run.budget_reserved_usd) || 0,
      };
    } catch (policyError) {
      logger.warn(`Could not load harness budget policy for run ${run.id}: ${policyError.message}`);
      const reserved = Number(run.budget_reserved_usd) || 0;
      // Fail closed enough to finish locally: keep the reservation cap and a
      // free-only routing hint rather than silently using unconstrained defaults.
      budgetPolicy = {
        source: 'reservation_only',
        reservedCostUsd: reserved,
        routing: { policy: 'free_only' },
        ...(reserved > 0 ? { limits: { maxCostUsd: reserved } } : {}),
      };
    }

    res.status(201).json({ success: true, data: run, budgetPolicy });
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

router.get('/agents/:agentId/runs', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    if (String(agentId) !== String(req.params.agentId)) {
      throw new ForbiddenError('Cannot list runs for another agent');
    }

    const runs = await HarnessRunService.listActiveRunsForAgent(agentId);
    res.json({ success: true, data: runs });
  } catch (error) {
    logger.error('GET /harness/agents/:agentId/runs failed:', error);
    next(error);
  }
});

router.get('/agents/:agentId/workspaces', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    if (String(agentId) !== String(req.params.agentId)) {
      throw new ForbiddenError('Cannot list workspaces for another agent');
    }

    const paths = await HarnessRunService.listActiveWorkspacePaths(agentId);
    res.json({ success: true, data: paths });
  } catch (error) {
    logger.error('GET /harness/agents/:agentId/workspaces failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/publish', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertCanReadRun(req, run);

    const updated = await HarnessRunService.recordPublish(
      req.params.runId,
      agentId,
      { headSha: req.body?.headSha, prUrl: req.body?.prUrl }
    );

    try {
      await HarnessAuditService.recordPublish({
        runId: updated.id,
        projectId: updated.project_id,
        ticketId: updated.ticket_id,
        agentId,
        headSha: updated.head_sha,
        prUrl: updated.pr_url,
        actorType: 'agent',
        actorId: agentId,
      });
    } catch (auditError) {
      // Publishing evidence is already durable; an audit write failure is
      // logged but must not make the agent retry a successful push/PR.
      logger.warn(`Harness publish audit failed for run ${updated.id}: ${auditError.message}`);
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/publish failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/reconcile', verifyTokenOrAgent, async (req, res, next) => {
  try {
    requireAgent(req);
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertCanReadRun(req, run);

    const reconciled = await HarnessRunService.reconcileRun(req.params.runId);
    if (!reconciled) {
      throw new ConflictError('Harness run is not terminal');
    }

    res.json({ success: true, data: reconciled });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/reconcile failed:', error);
    next(error);
  }
});

async function assertOperatorCanAccess(req, run) {
  if (req.agent) {
    throw new ForbiddenError('Operator JWT required');
  }

  const role = req.user?.role;
  const userId = req.user?.userId || req.user?.id;
  if (
    !role ||
    !userId ||
    !OPERATOR_ROLES.has(role) ||
    !(await PermissionService.hasPermission(role, 'TICKET_UPDATE'))
  ) {
    throw new ForbiddenError('Operator ticket permission required');
  }
  if (role === 'super_admin') {
    return;
  }

  await assertProjectAccess(run, userId);
}

router.post('/runs/:runId/dead-letter', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertOperatorCanAccess(req, run);

    const dead = await HarnessRunService.deadLetterRun(req.params.runId, {
      error: req.body?.error,
    });
    res.json({ success: true, data: dead });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/dead-letter failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/adopt', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const run = await HarnessRunService.getRun(req.params.runId);
    await assertOperatorCanAccess(req, run);

    const adopted = await HarnessRunService.adoptPublishedRun(req.params.runId, {
      prUrl: req.body?.prUrl,
    });
    res.json({ success: true, data: adopted });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/adopt failed:', error);
    next(error);
  }
});

router.post('/runs/:runId/release-ticket', verifyTokenOrAgent, async (req, res, next) => {
  try {
    let released;
    if (req.agent) {
      // Agents may only release failed runs; dead_letter is a manual hold.
      const agentId = requireAgent(req);
      released = await HarnessRunService.releaseTicketForRun(
        req.params.runId,
        { agentId }
      );
    } else {
      const run = await HarnessRunService.getRun(req.params.runId);
      await assertOperatorCanAccess(req, run);
      released = await HarnessRunService.releaseTicketForRun(
        req.params.runId,
        { allowDeadLetter: true }
      );
    }

    res.json({ success: true, data: { released: Boolean(released) } });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/release-ticket failed:', error);
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

    try {
      if (finished.head_sha || finished.pr_url) {
        await HarnessAuditService.recordPublish({
          runId: finished.id,
          projectId: finished.project_id,
          ticketId: finished.ticket_id,
          agentId: finished.agent_id,
          headSha: finished.head_sha,
          prUrl: finished.pr_url,
          actorType: 'agent',
          actorId: finished.agent_id,
          reason: `run finished as ${finished.status}`,
        });
      }
    } catch (auditError) {
      logger.warn(`Harness finish audit failed for run ${finished.id}: ${auditError.message}`);
    }

    let artifactsComplete = true;
    try {
      await HarnessEventService.ensureTerminalEvent({
        runId: finished.id,
        status: finished.status,
        error: finished.error,
        headSha: finished.head_sha,
        prUrl: finished.pr_url,
      });
    } catch (eventError) {
      artifactsComplete = false;
      logger.warn(`Harness terminal event failed for run ${finished.id}: ${eventError.message}`);
    }

    try {
      await HarnessUsageService.flushRunToUsageLogs(finished.id);
    } catch (usageError) {
      artifactsComplete = false;
      logger.warn(`Harness usage flush failed for run ${finished.id}: ${usageError.message}`);
    }

    if (artifactsComplete) {
      try {
        await HarnessRunService.markArtifactsFinalized(finished.id);
      } catch (markError) {
        logger.warn(`Harness run ${finished.id} could not be marked finalized: ${markError.message}`);
      }
    }

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
