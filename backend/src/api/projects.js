const express = require('express');
const router = express.Router();
const { requireAnyPermission } = require('../middleware/permissions');
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createProjectSchema, updateProjectSchema } = require('../validators/projects');
const projectController = require('../controllers/projectController');

// List all projects for user
router.get('/', requireAnyPermission('PROJECT_READ'), projectController.listProjects);

// Create new project
router.post('/', verifyToken, requireAnyPermission('PROJECT_CREATE'), validate(createProjectSchema), projectController.createProject);

// Get project tickets
router.get('/:id/tickets', projectController.getProjectTickets);

// Get ticket by status
router.get('/:id/tickets/status/:status', projectController.getProjectTicketsByStatus);

// Get project memberships
router.get('/:id/members', projectController.getProjectMemberships);

// Get users who can be assigned to tickets in this project
router.get('/:id/users', projectController.getProjectUsers);

// Get single project
router.get('/:id', projectController.getProject);

// Update project
router.put('/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), validate(updateProjectSchema), projectController.updateProject);

// Update ticket status
router.post('/:id/tickets/:ticketId/status', requireAnyPermission('TICKET_STATUS_CHANGE'), projectController.updateProjectTicketStatus);

// Create ticket
router.post('/:id/tickets', verifyToken, requireAnyPermission('TICKET_CREATE'), projectController.createProjectTicket);

// Update ticket
router.put('/tickets/:ticketId', verifyToken, requireAnyPermission('TICKET_UPDATE'), projectController.updateProjectTicket);

// Delete ticket (permission + ownership checked in service)
router.delete('/tickets/:ticketId', verifyToken, projectController.deleteProjectTicket);

// Delete project
router.delete('/:id', verifyToken, requireAnyPermission('PROJECT_DELETE'), projectController.deleteProject);

module.exports = router;
