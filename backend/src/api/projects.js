const express = require('express');
const router = express.Router();
const { requireAnyPermission } = require('../middleware/permissions');
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createProjectSchema, updateProjectSchema } = require('../validators/projects');
const { updateTicketSchema } = require('../validators/tickets');
const projectController = require('../controllers/projectController');

// Deprecation stubs for old per-project provider routes
router.use('/:projectId/providers', (req, res) => {
  res.status(410).json({
    success: false,
    error: { code: 'DEPRECATED', message: 'Providers are now global. Use /api/v1/providers instead.' }
  });
});

/**
 * @openapi
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: List projects for current user
 *     responses:
 *       200:
 *         description: List of projects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Project'
 */
router.get('/', verifyToken, requireAnyPermission('PROJECT_READ'), projectController.listProjects);

/**
 * @openapi
 * /projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create a new project
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Project created
 *       400:
 *         description: Validation error
 */
router.post('/', verifyToken, requireAnyPermission('PROJECT_CREATE'), validate(createProjectSchema), projectController.createProject);

/**
 * @openapi
 * /projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: Get project details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Project details with ticket info
 *       404:
 *         description: Project not found
 */
router.get('/:id', verifyToken, projectController.getProject);

/**
 * @openapi
 * /projects/{id}:
 *   put:
 *     tags: [Projects]
 *     summary: Update project
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Project updated
 *       404:
 *         description: Project not found
 */
router.put('/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), validate(updateProjectSchema), projectController.updateProject);

/**
 * @openapi
 * /projects/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete project
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Project deleted
 *       404:
 *         description: Project not found
 */
router.delete('/:id', verifyToken, requireAnyPermission('PROJECT_DELETE'), projectController.deleteProject);

/**
 * @openapi
 * /projects/{id}/tickets:
 *   get:
 *     tags: [Projects]
 *     summary: Get all tickets for a project
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of tickets
 */
router.get('/:id/tickets', verifyToken, projectController.getProjectTickets);

/**
 * @openapi
 * /projects/{id}/tickets/status/{status}:
 *   get:
 *     tags: [Projects]
 *     summary: Get tickets by status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: status
 *         required: true
 *         schema: { type: string, enum: [backlog, in_progress, review, done] }
 *     responses:
 *       200:
 *         description: Filtered tickets
 */
router.get('/:id/tickets/status/:status', verifyToken, projectController.getProjectTicketsByStatus);

/**
 * @openapi
 * /projects/{id}/members:
 *   get:
 *     tags: [Projects]
 *     summary: Get project members
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of project members
 */
router.get('/:id/members', verifyToken, projectController.getProjectMemberships);

/**
 * @openapi
 * /projects/{id}/users:
 *   get:
 *     tags: [Projects]
 *     summary: Get users who can be assigned to tickets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of assignable users
 */
router.get('/:id/users', verifyToken, projectController.getProjectUsers);

/**
 * @openapi
 * /projects/{id}/tickets:
 *   post:
 *     tags: [Projects]
 *     summary: Create ticket in project
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               priority: { type: string, enum: [low, medium, high, urgent] }
 *     responses:
 *       201:
 *         description: Ticket created
 */
router.post('/:id/tickets', verifyTokenOrAgent, requireAnyPermission('TICKET_CREATE'), projectController.createProjectTicket);

/**
 * @openapi
 * /projects/tickets/{ticketId}:
 *   put:
 *     tags: [Projects]
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
router.put('/tickets/:ticketId', verifyToken, requireAnyPermission('TICKET_UPDATE'), validate(updateTicketSchema), projectController.updateProjectTicket);

/**
 * @openapi
 * /projects/tickets/{ticketId}:
 *   delete:
 *     tags: [Projects]
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
router.delete('/tickets/:ticketId', verifyToken, projectController.deleteProjectTicket);

/**
 * @openapi
 * /projects/{id}/tickets/{ticketId}/status:
 *   post:
 *     tags: [Projects]
 *     summary: Update ticket status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
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
router.post('/:id/tickets/:ticketId/status', verifyToken, requireAnyPermission('TICKET_STATUS_CHANGE'), projectController.updateProjectTicketStatus);

module.exports = router;
