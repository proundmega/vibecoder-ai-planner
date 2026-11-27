const express = require('express');
const router = express.Router();
const { requireAnyPermission } = require('../middleware/permissions');
const {
  requireHumanStatusPermission,
  requireHumanProjectMembership,
} = require('../middleware/humanActor');
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { validate, validatePathParams } = require('../middleware/validate');
const { requireRuntime, requireTicketGrant, requireBodyGrant } = require('../middleware/agentRole');
const LIVE_RUNTIME = 'running';
const RELEASABLE_RUNTIME = ['running', 'draining'];
const { forBodyProject, forProjectParam, forTicketParam } = require('../middleware/agentProjectScope');
const {
  createTicketSchema,
  updateTicketSchema,
  statusTransitionSchema,
  commentSchema,
  phaseTransitionSchema,
  postMessageSchema,
  readinessOverrideSchema,
  smallFixSchema,
  acceptanceCriteriaSchema,
  criterionSchema,
} = require('../validators/tickets');
const { statusFilterSchema } = require('../validators/statusFilter');
const { paginationSchema } = require('../validators/pagination');
const { jsonContentTypeSchema } = require('../validators/contentType');
const { pathParams } = require('../validators/pathParams');
const { pool } = require('../db');
const ticketController = require('../controllers/ticketController');
const phaseService = require('../services/PhaseService');
const GitHubService = require('../services/GitHubService');
const readinessController = require('../controllers/ticketReadinessController');

/**
 * @openapi
 * /tickets:
 *   post:
 *     tags: [Tickets]
 *     summary: Create a new ticket
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId, title]
 *             properties:
 *               projectId: { $ref: '#/components/schemas/NumericId' }
 *               title: { type: string }
 *               description: { type: string }
 *               priority: { type: string, enum: [low, medium, high, critical, urgent] }
 *               template: { type: string, enum: [architecture, technical, simple, specification] }
 *               acceptanceCriteria:
 *                 type: array
 *                 items: { type: string }
 *               smallFix:
 *                 type: object
 *                 properties:
 *                   reason: { type: string, minLength: 10 }
 *     responses:
 *       201:
 *         description: Ticket created as a draft (readiness is enforced at execution, not creation)
 */
router.post('/', verifyTokenOrAgent, requireRuntime('running'), requireAnyPermission('TICKET_CREATE'), validate({ body: createTicketSchema }), forBodyProject('projectId'), requireBodyGrant('worker'), ticketController.createTicket);

/**
 * @openapi
 * /tickets/project/{projectId}:
 *   get:
 *     tags: [Tickets]
 *     summary: Get tickets for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [backlog, in_progress, review, done] }
 *     responses:
 *       200:
 *         description: List of tickets
 */
router.get('/project/:projectId', verifyTokenOrAgent, forProjectParam(), validatePathParams({ projectId: pathParams.projectId }), validate({ query: statusFilterSchema }), ticketController.getProjectTickets);

/**
 * @openapi
 * /tickets/project/{projectId}/backlog:
 *   get:
 *     tags: [Tickets]
 *     summary: Get dependency-ready backlog tickets for agent execution
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Backlog tickets whose dependencies are complete
 */
router.get('/project/:projectId/backlog', verifyTokenOrAgent, forProjectParam(), validatePathParams({ projectId: pathParams.projectId }), ticketController.getBacklogTickets);

/**
 * @openapi
 * /tickets/{ticketId}:
 *   get:
 *     tags: [Tickets]
 *     summary: Get single ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Ticket details
 *       404:
 *         description: Ticket not found
 */
router.get('/:ticketId', verifyTokenOrAgent, forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), ticketController.getTicket);

/**
 * @openapi
 * /tickets/{ticketId}:
 *   put:
 *     tags: [Tickets]
 *     summary: Update ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               status: { type: string }
 *               priority: { type: string }
 *               assigneeId: { type: string, pattern: '^[0-9]+$', nullable: true }
 *               milestoneId: { type: string, format: uuid, nullable: true }
 *               estimate: { type: integer, minimum: 1, nullable: true }
 *               dependsOn:
 *                 type: array
 *                 items:
 *                   oneOf:
 *                     - { type: integer }
 *                     - { type: string, pattern: '^[0-9]+$' }
 *     responses:
 *       200:
 *         description: Ticket updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/Ticket'
 *       409:
 *         description: Ticket has incomplete dependencies or is not ready for execution (READINESS_FAILED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:ticketId', verifyTokenOrAgent, requireRuntime('running'), forTicketParam(), requireTicketGrant('worker'), requireAnyPermission('TICKET_UPDATE'), validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: updateTicketSchema }), ticketController.updateTicket);

/**
 * @openapi
 * /tickets/{ticketId}:
 *   delete:
 *     tags: [Tickets]
 *     summary: Delete ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Ticket deleted
 *       409:
 *         description: Ticket is in progress and must be moved to backlog before deletion
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:ticketId', verifyToken, validatePathParams({ ticketId: pathParams.ticketId }), ticketController.deleteTicket);

/**
 * @openapi
 * /tickets/{ticketId}/status:
 *   post:
 *     tags: [Tickets]
 *     summary: Change ticket status (agent workflow)
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [backlog, in_progress, review, done] }
 *     responses:
 *       200:
 *         description: Status updated
 *       409:
 *         description: Ticket has incomplete dependencies
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:ticketId/status', verifyTokenOrAgent, requireRuntime('running'), forTicketParam(), requireTicketGrant('worker'), requireAnyPermission('TICKET_STATUS_CHANGE'), validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: statusTransitionSchema }), ticketController.changeStatus);

/**
 * @openapi
 * /tickets/{ticketId}/readiness:
 *   get:
 *     tags: [Tickets]
 *     summary: Evaluate the ticket Definition of Ready
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Readiness result with issues
 */
router.get(
  '/:ticketId/readiness',
  verifyTokenOrAgent,
  forTicketParam(),
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READ'),
  (req, res, next) => readinessController.get(req, res, next).catch(next)
);

/**
 * @openapi
 * /tickets/{ticketId}/readiness/approve-plan:
 *   post:
 *     tags: [Tickets]
 *     summary: Approve the plan (content-bound readiness approval)
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Plan approved
 *       409:
 *         description: Readiness checks still fail
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  '/:ticketId/readiness/approve-plan',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READINESS_APPROVE'),
  (req, res, next) => readinessController.approvePlan(req, res, next).catch(next)
);

/**
 * @openapi
 * /tickets/{ticketId}/readiness/small-fix:
 *   post:
 *     tags: [Tickets]
 *     summary: Record a small-fix template exemption
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Exemption recorded
 */
router.post(
  '/:ticketId/readiness/small-fix',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READINESS_OVERRIDE'),
  validate({ headers: jsonContentTypeSchema, body: smallFixSchema }),
  (req, res, next) => readinessController.smallFix(req, res, next).catch(next)
);

/**
 * @openapi
 * /tickets/{ticketId}/readiness/replan:
 *   post:
 *     tags: [Tickets]
 *     summary: Reopen planning and clear approval/ready state
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Planning reopened
 */
router.post(
  '/:ticketId/readiness/replan',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READINESS_APPROVE'),
  (req, res, next) => readinessController.replan(req, res, next).catch(next)
);

/**
 * @openapi
 * /tickets/{ticketId}/readiness/override:
 *   post:
 *     tags: [Tickets]
 *     summary: Grant a scoped, expiring readiness waiver
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [codes, reason, expiresAt]
 *             properties:
 *               codes: { type: array, items: { type: string } }
 *               reason: { type: string }
 *               expiresAt: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Override granted
 *   delete:
 *     tags: [Tickets]
 *     summary: Revoke a readiness waiver
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Override revoked
 */
router.post(
  '/:ticketId/readiness/override',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READINESS_OVERRIDE'),
  validate({ headers: jsonContentTypeSchema, body: readinessOverrideSchema }),
  (req, res, next) => readinessController.override(req, res, next).catch(next)
);
router.delete(
  '/:ticketId/readiness/override',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READINESS_OVERRIDE'),
  (req, res, next) => readinessController.revokeOverride(req, res, next).catch(next)
);

/**
 * @openapi
 * /tickets/{ticketId}/acceptance-criteria:
 *   get:
 *     tags: [Tickets]
 *     summary: List acceptance criteria
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Acceptance criteria
 *   post:
 *     tags: [Tickets]
 *     summary: Add acceptance criteria (array or { criteria })
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       201:
 *         description: Criteria created
 */
router.get(
  '/:ticketId/acceptance-criteria',
  verifyTokenOrAgent,
  forTicketParam(),
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_READ'),
  (req, res, next) => readinessController.listCriteria(req, res, next).catch(next)
);
router.post(
  '/:ticketId/acceptance-criteria',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId }),
  requireAnyPermission('TICKET_UPDATE'),
  validate({ headers: jsonContentTypeSchema, body: acceptanceCriteriaSchema }),
  (req, res, next) => readinessController.addCriteria(req, res, next).catch(next)
);
router.put(
  '/:ticketId/acceptance-criteria/:criterionId',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId, criterionId: pathParams.criterionId }),
  requireAnyPermission('TICKET_UPDATE'),
  validate({ headers: jsonContentTypeSchema, body: criterionSchema }),
  (req, res, next) => readinessController.updateCriterion(req, res, next).catch(next)
);
router.delete(
  '/:ticketId/acceptance-criteria/:criterionId',
  verifyToken,
  validatePathParams({ ticketId: pathParams.ticketId, criterionId: pathParams.criterionId }),
  requireAnyPermission('TICKET_UPDATE'),
  (req, res, next) => readinessController.deleteCriterion(req, res, next).catch(next)
);

/**
 * @openapi
 * /tickets/{ticketId}/pickup:
 *   post:
 *     tags: [Tickets]
 *     summary: Agent picks up a ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Ticket picked up
 *       409:
 *         description: Ticket has incomplete dependencies
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Bodyless route - agent picks up ticket without request body
router.post('/:ticketId/pickup', verifyTokenOrAgent, requireRuntime(LIVE_RUNTIME), forTicketParam(), requireTicketGrant('worker'), validatePathParams({ ticketId: pathParams.ticketId }), ticketController.pickUpTicket);

/**
 * @openapi
 * /tickets/{ticketId}/release:
 *   post:
 *     tags: [Tickets]
 *     summary: Agent releases a ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Ticket released
 */
// Bodyless route - agent releases ticket without request body
router.post('/:ticketId/release', verifyTokenOrAgent, requireRuntime(...RELEASABLE_RUNTIME), forTicketParam(), requireTicketGrant('worker'), validatePathParams({ ticketId: pathParams.ticketId }), ticketController.releaseTicket);

/**
 * @openapi
 * /tickets/{ticketId}/comments:
 *   get:
 *     tags: [Tickets]
 *     summary: Get ticket comments
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: List of comments
 */
router.get('/:ticketId/comments', verifyToken, validatePathParams({ ticketId: pathParams.ticketId }), ticketController.getTicketComments);

/**
 * @openapi
 * /tickets/{ticketId}/comments:
 *   post:
 *     tags: [Tickets]
 *     summary: Add comment to ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Comment added
 */
router.post('/:ticketId/comments', verifyToken, requireAnyPermission('TICKET_COMMENT'), validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: commentSchema }), ticketController.addComment);

/**
 * @openapi
 * /tickets/{ticketId}/messages:
 *   get:
 *     tags: [Tickets]
 *     summary: Get ticket messages
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get('/:ticketId/messages', verifyTokenOrAgent, forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), validate({ query: paginationSchema }), ticketController.getMessages);

/**
 * @openapi
 * /tickets/{ticketId}/messages:
 *   post:
 *     tags: [Tickets]
 *     summary: Post message to ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageType: { type: string }
 *               content: { type: string }
 *               metadata: { type: object }
 *     responses:
 *       201:
 *         description: Message posted
 */
router.post('/:ticketId/messages', verifyTokenOrAgent, forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: postMessageSchema }), ticketController.postMessage);

/**
 * @openapi
 * /tickets/{ticketId}/phases:
 *   get:
 *     tags: [Tickets]
 *     summary: Get phase transition history
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Phase history
 */
router.get('/:ticketId/phases', verifyTokenOrAgent, forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
  try {
    const history = await phaseService.getPhaseHistory(req.params.ticketId);
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /tickets/{ticketId}/phases/current:
 *   get:
 *     tags: [Tickets]
 *     summary: Get current phase
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Current phase
 */
router.get('/:ticketId/phases/current', verifyTokenOrAgent, forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
  try {
    const currentPhase = await phaseService.getCurrentPhase(req.params.ticketId);
    res.json({ success: true, data: { phase: currentPhase } });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /tickets/{ticketId}/phases/allowed:
 *   get:
 *     tags: [Tickets]
 *     summary: Get allowed next phases
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Allowed next phases
 */
router.get('/:ticketId/phases/allowed', verifyTokenOrAgent, forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
  try {
    const allowed = await phaseService.getAllowedNextPhases(req.params.ticketId);
    res.json({ success: true, data: { allowed: allowed } });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /tickets/{ticketId}/phases/transition:
 *   post:
 *     tags: [Tickets]
 *     summary: Transition ticket to a new phase
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toPhase]
 *             properties:
 *               toPhase: { type: string }
 *               actorType: { type: string, enum: [human, agent] }
 *               metadata: { type: object }
 *     responses:
 *       200:
 *         description: Phase transitioned
 *       409:
 *         description: Phase enters execution but dependencies are incomplete
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:ticketId/phases/transition', verifyTokenOrAgent, requireRuntime('running'), forTicketParam(), validatePathParams({ ticketId: pathParams.ticketId }), requireTicketGrant('worker'), requireHumanStatusPermission, requireHumanProjectMembership, validate({ headers: jsonContentTypeSchema, body: phaseTransitionSchema }), async (req, res, next) => {
  try {
    const { toPhase, actorType, metadata } = req.body;
    // The actor type is a property of the credential, never of the body: a
    // worker agent must not claim `human` (which would bypass the reviewer
    // dispatch gate and mislabel the phase history).
    const derivedActorType = req.agent ? 'agent' : 'human';
    if (actorType && actorType !== derivedActorType) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ACTOR_TYPE',
          message: `actorType '${actorType}' does not match the authenticated caller`,
        },
      });
    }
    // Agent phase transitions cannot complete a ticket directly; done/deployed
    // must go through the approval path like a status change.
    if (req.agent && (toPhase === 'done' || toPhase === 'deployed')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'AI agents must submit a review ticket for approval, not complete it',
        },
      });
    }
    const actorId = req.agent
      ? req.agent.id
      : (req.user?.userId ?? req.user?.id ?? null);
    const result = await phaseService.transition(
      req.params.ticketId,
      toPhase,
      derivedActorType,
      actorId,
      metadata || null
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /tickets/{ticketId}/review/diff:
 *   get:
 *     tags: [Tickets]
 *     summary: Get PR diff for a ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: PR diff files
 *       400:
 *         description: No PR linked or invalid URL
 *       404:
 *         description: Ticket not found
 */
router.get('/:ticketId/review/diff', verifyTokenOrAgent, requireRuntime(LIVE_RUNTIME), forTicketParam(), requireTicketGrant('reviewer'), validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
  try {
    const ticket = await pool.query('SELECT project_id, pr_url FROM tickets WHERE id = $1', [req.params.ticketId]);
    if (ticket.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }
    if (!ticket.rows[0].pr_url) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No PR linked to this ticket' } });
    }
    // Validate project exists before attempting PR diff
    const project = await pool.query('SELECT id FROM projects WHERE id = $1', [ticket.rows[0].project_id]);
    if (project.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found for this ticket' } });
    }
    const diff = await GitHubService.getPRDiff(ticket.rows[0].project_id, req.params.ticketId);
    res.json({ success: true, data: diff });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
