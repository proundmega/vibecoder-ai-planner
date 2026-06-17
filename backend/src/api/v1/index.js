const express = require('express');
const router = express.Router();

const userRouter = require('../user');
const usersManagementRouter = require('../users');
const projectsRouter = require('../projects');
const ticketsRouter = require('../tickets');
const pricingRouter = require('../pricing');
const agentsRouter = require('../agents');
const approvalsRouter = require('../approvals');
const permissionsRouter = require('../permissions');
const githubRouter = require('../github');
const providersRouter = require('../providers');
const credentialsRouter = require('../credentials');
const usageRouter = require('../usage');
const billingRouter = require('../billing');
const memoryRouter = require('../memory');
const ticketPlanningRouter = require('../ticketPlanning');
const ticketAttachmentRouter = require('../ticketAttachment');

// Mount all route modules under /v1
router.use('/users', userRouter);
router.use('/users-management', usersManagementRouter);
router.use('/projects', projectsRouter);
router.use('/tickets', ticketsRouter);
router.use('/pricing', pricingRouter);
router.use('/agents', agentsRouter);
router.use('/approvals', approvalsRouter);
router.use('/permissions', permissionsRouter);
router.use('/github', githubRouter);
router.use('/providers', providersRouter);
router.use('/credentials', credentialsRouter);
router.use('/usage', usageRouter);
router.use('/billing', billingRouter);
router.use('/memory', memoryRouter);

// Planning routes (nested under tickets)
router.post('/tickets/:ticketId/planning/apply-template', ticketPlanningRouter.handleApplyTemplate);
router.patch('/tickets/:ticketId/planning/status', ticketPlanningRouter.handleUpdateStatus);
router.use('/tickets/:ticketId/planning', ticketPlanningRouter);

// Attachment routes (nested under tickets)
router.use('/tickets/:ticketId/attachments', ticketAttachmentRouter);

// Serve attachment files
router.get('/attachments/:attachmentId', ticketAttachmentRouter.handleGetFile);

module.exports = router;
