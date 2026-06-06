const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createProjectSchema, updateProjectSchema } = require('../validators/projects');
const projectController = require('../controllers/projectController');

// List all projects for user
router.get('/', projectController.listProjects);

// Create new project
router.post('/', verifyToken, validate(createProjectSchema), projectController.createProject);

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
router.put('/:id', verifyToken, validate(updateProjectSchema), projectController.updateProject);

// Update ticket status
router.post('/:id/tickets/:ticketId/status', projectController.updateProjectTicketStatus);

// Create ticket
router.post('/:id/tickets', verifyToken, projectController.createProjectTicket);

// Update ticket
router.put('/tickets/:ticketId', verifyToken, projectController.updateProjectTicket);

// Delete ticket (admin/member: any ticket, user: own ticket only)
router.delete('/tickets/:ticketId', verifyToken, requireRole('project_admin', 'member', 'user'), projectController.deleteProjectTicket);

// Delete project
router.delete('/:id', verifyToken, requireRole('project_admin'), projectController.deleteProject);

module.exports = router;
