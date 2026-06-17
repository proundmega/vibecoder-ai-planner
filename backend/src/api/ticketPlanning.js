const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const controller = require('../controllers/ticketPlanningController');

/**
 * @openapi
 * /tickets/{id}/planning:
 *   get:
 *     tags: [Planning]
 *     summary: List planning files for a ticket
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Planning files list
 */
router.get('/', verifyTokenOrAgent, controller.list.bind(controller));

/**
 * @openapi
 * /tickets/{id}/planning/{fileKey}:
 *   get:
 *     tags: [Planning]
 *     summary: Get a specific planning file
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: fileKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Planning file content
 */
router.get('/:fileKey', verifyTokenOrAgent, controller.get.bind(controller));

/**
 * @openapi
 * /tickets/{id}/planning/{fileKey}:
 *   put:
 *     tags: [Planning]
 *     summary: Create or update a planning file
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: fileKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Planning file updated
 */
router.put('/:fileKey', verifyToken, controller.upsert.bind(controller));

/**
 * @openapi
 * /tickets/{id}/planning/apply-template:
 *   post:
 *     tags: [Planning]
 *     summary: Apply a template to create initial planning files
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [templateName]
 *             properties:
 *               templateName:
 *                 type: string
 *                 enum: [architect]
 *     responses:
 *       200:
 *         description: Template applied
 */
router.post('/apply-template', verifyToken, controller.applyTemplate.bind(controller));

/**
 * @openapi
 * /tickets/{id}/planning/status:
 *   patch:
 *     tags: [Planning]
 *     summary: Update planning status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [not_started, template_selected, in_progress, review, completed]
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch('/status', verifyToken, controller.updateStatus.bind(controller));

router.handleApplyTemplate = controller.applyTemplate.bind(controller);
router.handleUpdateStatus = controller.updateStatus.bind(controller);

module.exports = router;
