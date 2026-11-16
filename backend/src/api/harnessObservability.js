const express = require('express');
const router = express.Router();
const HarnessRunService = require('../services/HarnessRunService');
const HarnessEventService = require('../services/HarnessEventService');
const HarnessMetrics = require('../services/HarnessMetrics');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const { verifyTokenOrAgent } = require('../middleware/auth');
const {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Harness event API (fg-41 slice 1).
 *
 * Agent events are scoped to the agent's own run. Operator reads are
 * project-scoped. The store itself is append-only; this router never updates
 * or deletes an event.
 */

const OPERATOR_ROLES = new Set(['super_admin', 'project_admin', 'member']);

function requireAgent(req) {
  if (!req.agent || !req.agent.id) {
    throw new ForbiddenError('Agent API key required');
  }
  return req.agent.id;
}

function operatorIdentity(req) {
  const role = req.user?.role;
  const userId = req.user?.userId || req.user?.id;
  if (!role || !userId || !OPERATOR_ROLES.has(role)) {
    throw new ForbiddenError('Operator permission required');
  }
  return { role, userId };
}

async function assertPermission(role, permission) {
  if (!(await PermissionService.hasPermission(role, permission))) {
    throw new ForbiddenError(`Permission ${permission} required`);
  }
}

async function assertProjectAccess(projectId, req, permission = 'TICKET_READ') {
  if (req.agent) {
    throw new ForbiddenError('Operator JWT required');
  }
  const { role, userId } = operatorIdentity(req);
  await assertPermission(role, permission);
  if (role === 'super_admin') {
    return;
  }

  const result = await pool.query(
    `SELECT p.owner_id,
            EXISTS (
              SELECT 1 FROM project_memberships pm
              WHERE pm.project_id = p.id AND pm.user_id = $2
            ) AS is_member
     FROM projects p
     WHERE p.id = $1`,
    [Number(projectId), userId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Project not found');
  }
  const { owner_id: ownerId, is_member: isMember } = result.rows[0];
  if (String(ownerId) !== String(userId) && !isMember) {
    throw new ForbiddenError('Not a member of this project');
  }
}

async function assertRunAccess(runId, req) {
  const run = await HarnessRunService.getRun(runId);
  if (req.agent) {
    if (String(run.agent_id) !== String(req.agent.id)) {
      throw new ForbiddenError('Harness run belongs to another agent');
    }
    return run;
  }
  const { role } = operatorIdentity(req);
  await assertPermission(role, 'TICKET_READ');
  if (role === 'super_admin') {
    return run;
  }
  let projectId = run.project_id;
  if (!projectId && run.ticket_id) {
    const ticket = await pool.query(
      'SELECT project_id FROM tickets WHERE id = $1',
      [run.ticket_id]
    );
    projectId = ticket.rows?.[0]?.project_id || null;
  }
  if (!projectId) {
    throw new NotFoundError('Harness run project not found');
  }
  await assertProjectAccess(projectId, req, 'TICKET_READ');
  return run;
}

function projectIdParam(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError('projectId must be a positive integer');
  }
  return parsed;
}

/**
 * @openapi
 * /harness/events:
 *   post:
 *     tags: [Harness]
 *     summary: Append a structured harness event
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventId, traceId, runId, type]
 *             properties:
 *               eventId: { type: string, format: uuid }
 *               traceId: { type: string, format: uuid }
 *               runId: { type: string, format: uuid }
 *               type: { type: string }
 *               version: { type: integer, minimum: 1 }
 *               sessionId: { type: string, nullable: true }
 *               timestamp: { type: string, format: date-time }
 *               payload: { type: object }
 *     responses:
 *       201:
 *         description: Event stored (or an existing idempotent duplicate)
 */
router.post('/events', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const body = req.body || {};
    if (body.type && typeof body.type === 'string' && body.type.startsWith('audit.')) {
      throw new ForbiddenError('Audit events can only be written by the backend');
    }
    const result = await HarnessEventService.emit({
      eventId: body.eventId,
      traceId: body.traceId,
      runId: body.runId,
      ticketId: body.ticketId,
      projectId: body.projectId,
      agentId,
      sessionId: body.sessionId,
      type: body.type,
      version: body.version,
      timestamp: body.timestamp,
      payload: body.payload,
      requireRunOwnership: true,
    });

    if (result.event.type === 'budget.warning') HarnessMetrics.recordBudgetWarning();
    if (result.event.type === 'budget.breach') HarnessMetrics.recordBudgetBreach();

    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      data: result.event,
      duplicate: result.duplicate,
    });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      HarnessMetrics.recordEventRejected(
        error.code === 'FORBIDDEN' ? 'forbidden' : 'validation'
      );
    }
    logger.error('POST /harness/events failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/runs/{runId}/events:
 *   get:
 *     tags: [Harness]
 *     summary: List the ordered events for a harness run
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000 }
 *     responses:
 *       200:
 *         description: Ordered events
 */
router.get('/runs/:runId/events', verifyTokenOrAgent, async (req, res, next) => {
  try {
    await assertRunAccess(req.params.runId, req);
    const events = await HarnessEventService.listForRun(req.params.runId, {
      limit: req.query.limit,
      before: req.query.before,
    });
    res.json({ success: true, data: events });
  } catch (error) {
    logger.error('GET /harness/runs/:runId/events failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/events:
 *   get:
 *     tags: [Harness]
 *     summary: Query project-scoped harness events
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Events
 */
router.get('/projects/:projectId/events', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'TICKET_READ');
    const events = await HarnessEventService.listForProject(projectId, {
      type: req.query.type,
      since: req.query.since,
      until: req.query.until,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, data: events });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/events failed:', error);
    next(error);
  }
});

module.exports = router;
