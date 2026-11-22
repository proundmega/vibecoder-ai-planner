const express = require('express');
const router = express.Router();
const TicketQuestionService = require('../services/TicketQuestionService');
const HarnessRunService = require('../services/HarnessRunService');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { forRunParam, forTicketParam } = require('../middleware/agentProjectScope');
const { requireRuntime, requireRunGrant } = require('../middleware/agentRole');
const { validate } = require('../middleware/validate');
const {
  createQuestionSchema,
  answerQuestionSchema,
  questionListQuerySchema,
} = require('../validators/questions');
const { ForbiddenError, NotFoundError, ValidationError } = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Human question loop API (fg-55).
 *
 * Agents create/read/expire questions for their own run; project members read
 * the inbox, answer, and see their notifications. A waiting run stays
 * `running`, so every existing lease and reaper rule still applies.
 */

const OPERATOR_ROLES = new Set(['super_admin', 'project_admin', 'member', 'user']);
const ANSWER_PERMISSION = 'AGENT_READ';

function userIdOf(req) {
  const id = req.user?.userId || req.user?.id;
  if (!id) {
    throw new ForbiddenError('Operator JWT required');
  }
  return id;
}

async function assertProjectAccess(projectId, req, permission) {
  const role = req.user?.role;
  const userId = userIdOf(req);
  if (!role || !OPERATOR_ROLES.has(role)) {
    throw new ForbiddenError('Operator permission required');
  }
  if (!(await PermissionService.hasPermission(role, permission))) {
    throw new ForbiddenError(`Permission ${permission} required`);
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
     FROM projects p
     WHERE p.id = $1`,
    [Number(projectId), userId]
  );
  if (access.rows.length === 0) {
    throw new NotFoundError('Project not found');
  }
  if (String(access.rows[0].owner_id) !== String(userId) && !access.rows[0].is_member) {
    throw new ForbiddenError('Not a member of this project');
  }
}

async function assertQuestionAccess(req, question, { write: _write = false } = {}) {
  if (req.agent) {
    if (!req.runtime || !req.runtime.id) {
      throw new ForbiddenError('Agent runtime required');
    }
    // Node grants are project/role scoped, so two workers in one project would
    // otherwise be able to read each other's runs by guessing the UUID. Own the
    // exact runtime for reads and writes alike.
    if (String(question.runtime_id) !== String(req.runtime.id)) {
      throw new ForbiddenError('Question belongs to another runtime');
    }
    return;
  }
  await assertProjectAccess(question.project_id, req, ANSWER_PERMISSION);
}

function questionIdParam(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError('questionId must be a positive integer');
  }
  return parsed;
}

function runIdParam(value) {
  if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError('runId must be a UUID');
  }
  return value;
}

/**
 * @openapi
 * /harness/runs/{runId}/questions:
 *   post:
 *     tags: [Harness]
 *     summary: Ask a human a question from a running harness run
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [prompt]
 *             properties:
 *               kind: { type: string, enum: [question, permission, doom_loop] }
 *               externalId: { type: string, nullable: true }
 *               prompt: { type: string, maxLength: 8192 }
 *               options: { type: object, nullable: true }
 *               expiresAt: { type: string, format: date-time, nullable: true }
 *     responses:
 *       201:
 *         description: Question persisted (or the existing idempotent row)
 *       403:
 *         description: Runtime does not own this run
 */
router.post(
  '/runs/:runId/questions',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forRunParam(),
  requireRunGrant('worker', 'reviewer', 'planner'),
  validate({ body: createQuestionSchema }),
  async (req, res, next) => {
    try {
      if (!req.agent || !req.runtime) {
        throw new ForbiddenError('Agent runtime required');
      }
      const question = await TicketQuestionService.createForRun({
        runId: runIdParam(req.params.runId),
        runtimeId: req.runtime.id,
        externalId: req.body.externalId,
        kind: req.body.kind,
        prompt: req.body.prompt,
        options: req.body.options,
        expiresAt: req.body.expiresAt,
      });
      res.status(201).json({
        success: true,
        data: {
          id: question.id,
          status: question.status,
          expiresAt: question.expires_at || null,
        },
      });
    } catch (error) {
      logger.error('POST /harness/runs/:runId/questions failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/runs/{runId}/questions/{questionId}:
 *   get:
 *     tags: [Harness]
 *     summary: Read a question and its answer
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Question status and answer
 */
router.get(
  '/runs/:runId/questions/:questionId',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forRunParam(),
  requireRunGrant('worker', 'reviewer', 'planner'),
  async (req, res, next) => {
    try {
      const question = await TicketQuestionService.getForRun(
        runIdParam(req.params.runId),
        questionIdParam(req.params.questionId)
      );
      await assertQuestionAccess(req, question);
      res.json({
        success: true,
        data: {
          id: question.id,
          status: question.status,
          kind: question.kind,
          answer: question.answer || null,
          answeredAt: question.answered_at || null,
          expiresAt: question.expires_at || null,
        },
      });
    } catch (error) {
      logger.error('GET /harness/runs/:runId/questions/:questionId failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/runs/{runId}/questions:
 *   get:
 *     tags: [Harness]
 *     summary: List questions for a harness run
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 */
router.get(
  '/runs/:runId/questions',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forRunParam(),
  requireRunGrant('worker', 'reviewer', 'planner'),
  validate({ query: questionListQuerySchema }),
  async (req, res, next) => {
    try {
      const runId = runIdParam(req.params.runId);
      const run = await HarnessRunService.getRun(runId);
      if (req.agent) {
        if (String(run.runtime_id) !== String(req.runtime.id)) {
          throw new ForbiddenError('Harness run belongs to another runtime');
        }
      } else {
        let projectId = run.project_id;
        if (projectId == null && run.ticket_id != null) {
          const ticket = await pool.query(
            'SELECT project_id FROM tickets WHERE id = $1',
            [Number(run.ticket_id)]
          );
          projectId = ticket.rows[0]?.project_id ?? null;
        }
        if (projectId == null) {
          throw new NotFoundError('Harness run project not found');
        }
        await assertProjectAccess(projectId, req, ANSWER_PERMISSION);
      }
      const questions = await TicketQuestionService.listForRun(runId, req.query);
      res.json({ success: true, data: questions });
    } catch (error) {
      logger.error('GET /harness/runs/:runId/questions failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/runs/{runId}/questions/{questionId}/expire:
 *   post:
 *     tags: [Harness]
 *     summary: Expire a pending question (idempotent)
 *     security:
 *       - ApiKeyAuth: []
 */
router.post(
  '/runs/:runId/questions/:questionId/expire',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forRunParam(),
  requireRunGrant('worker', 'reviewer', 'planner'),
  async (req, res, next) => {
    try {
      if (!req.agent || !req.runtime) {
        throw new ForbiddenError('Agent runtime required');
      }
      const question = await TicketQuestionService.getForRun(
        runIdParam(req.params.runId),
        questionIdParam(req.params.questionId)
      );
      await assertQuestionAccess(req, question, { write: true });
      const expired = await TicketQuestionService.expire(
        req.params.runId,
        req.params.questionId
      );
      res.json({ success: true, data: { status: expired.status } });
    } catch (error) {
      logger.error('POST /harness/runs/:runId/questions/:questionId/expire failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/runs/{runId}/questions/{questionId}/answer:
 *   post:
 *     tags: [Harness]
 *     summary: Answer a pending question as a project member
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answer]
 *             properties:
 *               answer: { type: string, maxLength: 8192 }
 *     responses:
 *       200:
 *         description: Question answered
 *       409:
 *         description: Already answered or expired
 */
router.post(
  '/runs/:runId/questions/:questionId/answer',
  verifyToken,
  validate({ body: answerQuestionSchema }),
  async (req, res, next) => {
    try {
      const question = await TicketQuestionService.getForRun(
        runIdParam(req.params.runId),
        questionIdParam(req.params.questionId)
      );
      await assertQuestionAccess(req, question, { write: true });
      const answered = await TicketQuestionService.answer(
        req.params.runId,
        req.params.questionId,
        { answer: req.body.answer, userId: userIdOf(req) }
      );
      res.json({
        success: true,
        data: {
          id: answered.id,
          status: answered.status,
          answeredAt: answered.answered_at || null,
        },
      });
    } catch (error) {
      logger.error('POST /harness/runs/:runId/questions/:questionId/answer failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/projects/{projectId}/questions:
 *   get:
 *     tags: [Harness]
 *     summary: List project questions for the question inbox
 *     security:
 *       - BearerAuth: []
 */
router.get(
  '/projects/:projectId/questions',
  verifyToken,
  validate({ query: questionListQuerySchema }),
  async (req, res, next) => {
    try {
      await assertProjectAccess(req.params.projectId, req, ANSWER_PERMISSION);
      const questions = await TicketQuestionService.listForProject(
        req.params.projectId,
        req.query
      );
      res.json({ success: true, data: questions });
    } catch (error) {
      logger.error('GET /harness/projects/:projectId/questions failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/tickets/{ticketId}/questions:
 *   get:
 *     tags: [Harness]
 *     summary: List questions for one ticket
 *     security:
 *       - BearerAuth: []
 */
router.get(
  '/tickets/:ticketId/questions',
  verifyToken,
  forTicketParam(),
  validate({ query: questionListQuerySchema }),
  async (req, res, next) => {
    try {
      const ticket = await pool.query(
        'SELECT project_id FROM tickets WHERE id = $1 AND deleted_at IS NULL',
        [Number(req.params.ticketId)]
      );
      if (ticket.rows.length === 0) {
        throw new NotFoundError('Ticket not found');
      }
      await assertProjectAccess(ticket.rows[0].project_id, req, ANSWER_PERMISSION);
      const questions = await TicketQuestionService.listForTicket(
        req.params.ticketId,
        req.query
      );
      res.json({ success: true, data: questions });
    } catch (error) {
      logger.error('GET /harness/tickets/:ticketId/questions failed:', error);
      next(error);
    }
  }
);

/**
 * @openapi
 * /harness/questions:
 *   get:
 *     tags: [Harness]
 *     summary: Cross-project question inbox for the current user
 *     security:
 *       - BearerAuth: []
 */
router.get(
  '/questions',
  verifyToken,
  validate({ query: questionListQuerySchema }),
  async (req, res, next) => {
    try {
      const questions = await TicketQuestionService.listForUser(
        userIdOf(req),
        req.query
      );
      res.json({ success: true, data: questions });
    } catch (error) {
      logger.error('GET /harness/questions failed:', error);
      next(error);
    }
  }
);

module.exports = router;
