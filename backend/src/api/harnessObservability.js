const express = require('express');
const router = express.Router();
const HarnessRunService = require('../services/HarnessRunService');
const HarnessEventService = require('../services/HarnessEventService');
const HarnessUsageService = require('../services/HarnessUsageService');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessDashboardService = require('../services/HarnessDashboardService');
const HarnessPrivacyService = require('../services/HarnessPrivacyService');
const HarnessAuditService = require('../services/HarnessAuditService');
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
 * Harness observability, replay, budget and audit API (fg-41 / fg-38).
 *
 * Agent events and usage are scoped to the agent's own run. Operator reads are
 * project-scoped; policy and kill-switch writes need PROJECT_UPDATE.
 */

const OPERATOR_ROLES = new Set(['super_admin', 'project_admin', 'member']);
const POLICY_WRITE_ROLES = new Set(['super_admin', 'project_admin']);

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

async function assertProjectAccess(projectId, req, permission = 'DASHBOARD_READ') {
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

async function assertRunAccess(runId, req, permission = 'TICKET_READ') {
  const run = await HarnessRunService.getRun(runId);
  if (req.agent) {
    if (String(run.agent_id) !== String(req.agent.id)) {
      throw new ForbiddenError('Harness run belongs to another agent');
    }
    return run;
  }
  const { role } = operatorIdentity(req);
  await assertPermission(role, permission);
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
  await assertProjectAccess(projectId, req, permission);
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

    if (result.event.type === 'review.result' || result.event.type === 'fix.requested') {
      try {
        await HarnessAuditService.recordReview({
          runId: result.event.run_id,
          projectId: result.event.project_id,
          ticketId: result.event.ticket_id,
          agentId: result.event.agent_id,
          result: result.event.type === 'review.result' ? 'review_result' : 'fix_requested',
          reason: result.event.payload?.summary || result.event.type,
          eventId: result.event.event_id,
          actorType: 'agent',
          actorId: agentId,
        });
      } catch (auditError) {
        logger.warn(`Harness review audit failed: ${auditError.message}`);
      }
    }

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
 * /harness/runs/{runId}/usage:
 *   post:
 *     tags: [Harness]
 *     summary: Report a cumulative usage snapshot for a harness run
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Usage stored (greatest value wins on retries)
 */
router.post('/runs/:runId/usage', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = requireAgent(req);
    const body = req.body || {};
    const row = await HarnessUsageService.recordUsage({
      runId: req.params.runId,
      agentId,
      model: body.model,
      promptVersion: body.promptVersion,
      configHash: body.configHash,
      routingReason: body.routingReason,
      inputTokens: body.inputTokens ?? body.tokensIn,
      outputTokens: body.outputTokens ?? body.tokensOut,
      cachedTokens: body.cachedTokens,
      toolCalls: body.toolCalls,
      durationMs: body.durationMs,
    });
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    logger.error('POST /harness/runs/:runId/usage failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/runs/{runId}/usage:
 *   get:
 *     tags: [Harness]
 *     summary: Read per-model usage for a harness run
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Usage rows and totals
 */
router.get('/runs/:runId/usage', verifyTokenOrAgent, async (req, res, next) => {
  try {
    await assertRunAccess(req.params.runId, req);
    const [rows, totals] = await Promise.all([
      HarnessUsageService.listForRun(req.params.runId),
      HarnessUsageService.getRunTotals(req.params.runId),
    ]);
    res.json({ success: true, data: { models: rows, totals } });
  } catch (error) {
    logger.error('GET /harness/runs/:runId/usage failed:', error);
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
 *       - in: query
 *         name: before
 *         description: Keyset cursor timestamp; requires beforeId
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: beforeId
 *         description: Keyset cursor event id for the same timestamp
 *         schema: { type: string, format: uuid }
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
      beforeId: req.query.beforeId,
    });
    res.json({ success: true, data: events });
  } catch (error) {
    logger.error('GET /harness/runs/:runId/events failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/runs/{runId}/timeline:
 *   get:
 *     tags: [Harness]
 *     summary: Replay timeline for a harness run (events, checkpoints, artifacts)
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 */
router.get('/runs/:runId/timeline', verifyTokenOrAgent, async (req, res, next) => {
  try {
    await assertRunAccess(req.params.runId, req);
    const timeline = await HarnessEventService.getTimeline(req.params.runId);
    res.json({ success: true, data: timeline });
  } catch (error) {
    logger.error('GET /harness/runs/:runId/timeline failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/runs:
 *   get:
 *     tags: [Harness]
 *     summary: List recent harness runs for a project (replay picker)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *     responses:
 *       200:
 *         description: Recent runs
 */
router.get('/projects/:projectId/runs', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'DASHBOARD_READ');
    const runs = await HarnessRunService.listRunsForProject(projectId, {
      limit: req.query.limit,
      since: req.query.since,
      until: req.query.until,
    });
    res.json({ success: true, data: runs });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/runs failed:', error);
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

/**
 * @openapi
 * /harness/projects/{projectId}/audit:
 *   get:
 *     tags: [Harness]
 *     summary: List immutable publish/review audit records
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Audit events
 */
router.get('/projects/:projectId/audit', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'TICKET_READ');
    const events = await HarnessEventService.listAudit(projectId, {
      since: req.query.since,
      until: req.query.until,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, data: events });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/audit failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/dashboard:
 *   get:
 *     tags: [Harness]
 *     summary: Harness runs, cost, review/fix rounds and alerts for a project
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: until
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Dashboard data
 */
router.get('/projects/:projectId/dashboard', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'DASHBOARD_READ');
    const dashboard = await HarnessDashboardService.getDashboard(projectId, {
      since: req.query.since,
      until: req.query.until,
    });
    res.json({ success: true, data: dashboard });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/dashboard failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/usage:
 *   get:
 *     tags: [Harness]
 *     summary: Harness token/cost usage grouped by model
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Usage summary
 */
router.get('/projects/:projectId/usage', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'DASHBOARD_READ');
    const usage = await HarnessUsageService.summarizeProject(projectId, {
      since: req.query.since,
      until: req.query.until,
    });
    res.json({ success: true, data: usage });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/usage failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/privacy-policy:
 *   get:
 *     tags: [Harness]
 *     summary: Read the project harness privacy and data-governance policy
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Effective privacy policy
 *   put:
 *     tags: [Harness]
 *     summary: Update the project privacy policy
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               maxDataClass: { type: string, enum: [public, internal, confidential, secret] }
 *               allowedProviders: { type: array, items: { type: string } }
 *               requireNoTraining: { type: boolean }
 *               localOnly: { type: boolean }
 *               localEndpoint: { type: string, nullable: true }
 *               localModel: { type: string, nullable: true }
 *               dataResidency: { type: string, nullable: true }
 *               blockOnSecret: { type: boolean }
 *               blockOnPii: { type: boolean }
 *               redactPii: { type: boolean }
 *               eventRetentionDays: { type: integer, minimum: 1, maximum: 3650 }
 *     responses:
 *       200:
 *         description: Updated privacy policy
 */
router.get('/projects/:projectId/privacy-policy', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'PROJECT_UPDATE');
    if (!POLICY_WRITE_ROLES.has(req.user?.role)) {
      throw new ForbiddenError('Project admin permission required');
    }
    const policy = await HarnessPrivacyService.getPolicy(projectId);
    res.json({ success: true, data: policy });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/privacy-policy failed:', error);
    next(error);
  }
});

router.put('/projects/:projectId/privacy-policy', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'PROJECT_UPDATE');
    if (!POLICY_WRITE_ROLES.has(req.user?.role)) {
      throw new ForbiddenError('Project admin permission required');
    }
    const actorId = req.user?.userId || req.user?.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const policy = await HarnessPrivacyService.upsertPolicy({
        projectId,
        policy: req.body || {},
        updatedBy: actorId,
        client,
      });
      await HarnessPrivacyService.recordPolicyAudit({
        projectId,
        policy,
        actorId,
        client,
      });
      await client.query('COMMIT');
      res.json({ success: true, data: policy });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('PUT /harness/projects/:projectId/privacy-policy failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/privacy/delete:
 *   post:
 *     tags: [Harness]
 *     summary: Delete project-scoped run data (audit tombstone retained)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dataClasses:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [events, usage, messages, checkpoints, runs, usage_logs, all]
 *               before: { type: string, format: date-time, nullable: true }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Deletion counts
 */
router.post('/projects/:projectId/privacy/delete', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'PROJECT_UPDATE');
    if (!POLICY_WRITE_ROLES.has(req.user?.role)) {
      throw new ForbiddenError('Project admin permission required');
    }
    const actorId = req.user?.userId || req.user?.id;
    const result = await HarnessPrivacyService.deleteProjectData({
      projectId,
      dataClasses: req.body?.dataClasses || ['events'],
      before: req.body?.before || null,
      reason: req.body?.reason || null,
      actorType: 'user',
      actorId,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('POST /harness/projects/:projectId/privacy/delete failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/privacy/export:
 *   get:
 *     tags: [Harness]
 *     summary: Export project harness run data
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Redacted project run data export
 */
router.get('/projects/:projectId/privacy/export', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'PROJECT_UPDATE');
    if (!POLICY_WRITE_ROLES.has(req.user?.role)) {
      throw new ForbiddenError('Project admin permission required');
    }
    const actorId = req.user?.userId || req.user?.id;
    const data = await HarnessPrivacyService.exportProjectData(projectId, {
      limit: req.query.limit,
    });
    try {
      await HarnessAuditService.recordPrivacy({
        projectId,
        action: 'export',
        reason: 'project data exported',
        actorType: 'user',
        actorId,
        payload: {
          events: data.events.length,
          usage: data.usage.length,
          runs: data.runs.length,
          checkpoints: data.checkpoints.length,
          messages: data.messages.length,
          usageLogs: data.usageLogs.length,
          hasMore: data.hasMore,
        },
      });
    } catch (auditError) {
      logger.warn(`Privacy export audit failed: ${auditError.message}`);
    }
    res.json({ success: true, data });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/privacy/export failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/budget-policy:
 *   get:
 *     tags: [Harness]
 *     summary: Read the effective budget and routing policy
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Effective policy
 *   put:
 *     tags: [Harness]
 *     summary: Update the project budget and routing policy
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Updated policy
 *       403:
 *         description: Project admin required
 */
router.get('/projects/:projectId/budget-policy', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'DASHBOARD_READ');
    const policy = await HarnessBudgetService.getPolicy(projectId);
    res.json({ success: true, data: policy });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/budget-policy failed:', error);
    next(error);
  }
});

router.put('/projects/:projectId/budget-policy', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'PROJECT_UPDATE');
    if (!POLICY_WRITE_ROLES.has(req.user?.role)) {
      throw new ForbiddenError('Project admin permission required');
    }
    const body = req.body || {};
    await HarnessBudgetService.upsertPolicy({
      projectId,
      scope: 'project',
      policy: body,
      updatedBy: req.user?.userId || req.user?.id,
    });
    const policy = await HarnessBudgetService.getPolicy(projectId);
    res.json({ success: true, data: policy });
  } catch (error) {
    logger.error('PUT /harness/projects/:projectId/budget-policy failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/kill-switch/audit:
 *   get:
 *     tags: [Harness]
 *     summary: List immutable kill-switch history for a project (including global)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Kill-switch audit rows
 */
router.get('/projects/:projectId/kill-switch/audit', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'DASHBOARD_READ');
    const rows = await HarnessBudgetService.listKillSwitchAudit(projectId, {
      limit: req.query.limit,
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/kill-switch/audit failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/projects/{projectId}/kill-switch:
 *   get:
 *     tags: [Harness]
 *     summary: Read the project kill switch
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Active project/global kill switch or null
 *   put:
 *     tags: [Harness]
 *     summary: Enable or disable the project kill switch
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Updated switch
 */
router.get('/projects/:projectId/kill-switch', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'DASHBOARD_READ');
    const killSwitch = await HarnessBudgetService.getKillSwitch(projectId);
    res.json({ success: true, data: killSwitch });
  } catch (error) {
    logger.error('GET /harness/projects/:projectId/kill-switch failed:', error);
    next(error);
  }
});

router.put('/projects/:projectId/kill-switch', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const projectId = projectIdParam(req.params.projectId);
    await assertProjectAccess(projectId, req, 'PROJECT_UPDATE');
    if (!POLICY_WRITE_ROLES.has(req.user?.role)) {
      throw new ForbiddenError('Project admin permission required');
    }
    const body = req.body || {};
    const row = await HarnessBudgetService.setKillSwitch({
      projectId,
      enabled: body.enabled,
      reason: body.reason,
      updatedBy: req.user?.userId || req.user?.id,
    });
    res.json({ success: true, data: row });
  } catch (error) {
    logger.error('PUT /harness/projects/:projectId/kill-switch failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /harness/kill-switch:
 *   get:
 *     tags: [Harness]
 *     summary: Read the global harness kill switch
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Active global switch or null
 *   put:
 *     tags: [Harness]
 *     summary: Enable or disable the global harness kill switch
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Updated switch
 *       403:
 *         description: super_admin required
 */
router.get('/kill-switch', verifyTokenOrAgent, async (req, res, next) => {
  try {
    if (req.agent) throw new ForbiddenError('Operator JWT required');
    const { role } = operatorIdentity(req);
    if (role !== 'super_admin') {
      throw new ForbiddenError('super_admin required');
    }
    const row = await HarnessBudgetService.getKillSwitch(null);
    res.json({ success: true, data: row });
  } catch (error) {
    logger.error('GET /harness/kill-switch failed:', error);
    next(error);
  }
});

router.put('/kill-switch', verifyTokenOrAgent, async (req, res, next) => {
  try {
    if (req.agent) throw new ForbiddenError('Operator JWT required');
    const { role, userId } = operatorIdentity(req);
    if (role !== 'super_admin') {
      throw new ForbiddenError('super_admin required');
    }
    const body = req.body || {};
    const row = await HarnessBudgetService.setKillSwitch({
      projectId: null,
      enabled: body.enabled,
      reason: body.reason,
      updatedBy: userId,
    });
    res.json({ success: true, data: row });
  } catch (error) {
    logger.error('PUT /harness/kill-switch failed:', error);
    next(error);
  }
});

module.exports = router;
