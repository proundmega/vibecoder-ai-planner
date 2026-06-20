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
const ticketPlanningController = require('../../controllers/ticketPlanningController');
const ticketAttachmentController = require('../../controllers/ticketAttachmentController');
const ticketAttachmentUpload = require('../../middleware/multer');
const { verifyToken } = require('../../middleware/auth');

// Mount all route modules under /v1
router.use('/users-management', userRouter);
router.use('/users', usersManagementRouter);
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

// Planning routes (inlined to preserve ticketId param)
router.get('/tickets/:ticketId/planning', verifyToken, (req, res, next) => ticketPlanningController.list(req, res, next).catch(next));
router.get('/tickets/:ticketId/planning/:fileKey', verifyToken, (req, res, next) => ticketPlanningController.get(req, res, next).catch(next));
router.put('/tickets/:ticketId/planning/:fileKey', verifyToken, (req, res, next) => ticketPlanningController.upsert(req, res, next).catch(next));
router.post('/tickets/:ticketId/planning/apply-template', verifyToken, (req, res, next) => ticketPlanningController.applyTemplate(req, res, next).catch(next));
router.patch('/tickets/:ticketId/planning/status', verifyToken, (req, res, next) => ticketPlanningController.updateStatus(req, res, next).catch(next));

// Attachment routes (nested under tickets, inlined to preserve ticketId param)
router.post('/tickets/:ticketId/attachments', verifyToken, ticketAttachmentUpload.single('file'), (req, res, next) => ticketAttachmentController.upload(req, res, next).catch(next));
router.get('/tickets/:ticketId/attachments', verifyToken, (req, res, next) => ticketAttachmentController.list(req, res, next).catch(next));
router.delete('/tickets/:ticketId/attachments/:attachmentId', verifyToken, (req, res, next) => ticketAttachmentController.delete(req, res, next).catch(next));

// Serve attachment files
router.get('/attachments/:attachmentId', verifyToken, (req, res, next) => ticketAttachmentController.get(req, res, next).catch(next));

module.exports = router;
