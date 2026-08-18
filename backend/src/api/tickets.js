const express = require('express');
const router = express.Router();
const { requireAnyPermission } = require('../middleware/permissions');
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { validate, validatePathParams } = require('../middleware/validate');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema, phaseTransitionSchema, postMessageSchema } = require('../validators/tickets');
const { statusFilterSchema } = require('../validators/statusFilter');
const { paginationSchema } = require('../validators/pagination');
const { jsonContentTypeSchema } = require('../validators/contentType');
const { pathParams } = require('../validators/pathParams');
const ticketController = require('../controllers/ticketController');
const phaseService = require('../services/PhaseService');
const GitHubService = require('../services/GitHubService');

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
 *               projectId: { type: string, format: uuid }
 *               title: { type: string }
 *               description: { type: string }
 *               priority: { type: string, enum: [low, medium, high, urgent] }
 *     responses:
 *       201:
 *         description: Ticket created
 */
router.post('/', verifyTokenOrAgent, requireAnyPermission('TICKET_CREATE'), validate({ body: createTicketSchema }), ticketController.createTicket);

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
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [backlog, in_progress, review, done] }
 *     responses:
 *       200:
 *         description: List of tickets
 */
router.get('/project/:projectId', verifyTokenOrAgent, validatePathParams({ projectId: pathParams.projectId }), validate({ query: statusFilterSchema }), ticketController.getProjectTickets);

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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ticket details
 *       404:
 *         description: Ticket not found
 */
router.get('/:ticketId', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), ticketController.getTicket);

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
 *         schema: { type: string, format: uuid }
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
 *               assigneeId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ticket updated
 */
router.put('/:ticketId', verifyTokenOrAgent, requireAnyPermission('TICKET_UPDATE'), validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: updateTicketSchema }), ticketController.updateTicket);

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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ticket deleted
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
 *         schema: { type: string, format: uuid }
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
 */
router.post('/:ticketId/status', verifyTokenOrAgent, requireAnyPermission('TICKET_STATUS_CHANGE'), validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: statusTransitionSchema }), ticketController.changeStatus);

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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ticket picked up
 */
// Bodyless route - agent picks up ticket without request body
router.post('/:ticketId/pickup', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), ticketController.pickUpTicket);

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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ticket released
 */
// Bodyless route - agent releases ticket without request body
router.post('/:ticketId/release', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), ticketController.releaseTicket);

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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get('/:ticketId/messages', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), validate({ query: paginationSchema }), ticketController.getMessages);

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
 *         schema: { type: string, format: uuid }
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
router.post('/:ticketId/messages', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: postMessageSchema }), ticketController.postMessage);

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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Phase history
 */
router.get('/:ticketId/phases', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Current phase
 */
router.get('/:ticketId/phases/current', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Allowed next phases
 */
router.get('/:ticketId/phases/allowed', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
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
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toPhase]
 *             properties:
 *               toPhase: { type: string }
 *               actorType: { type: string, enum: [human, agent, system] }
 *               metadata: { type: object }
 *     responses:
 *       200:
 *         description: Phase transitioned
 */
router.post('/:ticketId/phases/transition', verifyTokenOrAgent, validatePathParams({ ticketId: pathParams.ticketId }), validate({ headers: jsonContentTypeSchema, body: phaseTransitionSchema }), async (req, res, next) => {
  try {
    const { toPhase, actorType, metadata } = req.body;
    const actorId = req.user ? req.user.id : (req.agent ? req.agent.id : null);
    const result = await phaseService.transition(
      req.params.ticketId,
      toPhase,
      actorType || 'system',
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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PR diff files
 *       400:
 *         description: No PR linked or invalid URL
 *       404:
 *         description: Ticket not found
 */
router.get('/:ticketId/review/diff', verifyToken, validatePathParams({ ticketId: pathParams.ticketId }), async (req, res, next) => {
  try {
    const diff = await GitHubService.getPRDiff(req.params.ticketId);
    res.json({ success: true, data: diff });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
