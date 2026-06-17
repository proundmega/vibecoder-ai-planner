const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const controller = require('../controllers/ticketAttachmentController');
const upload = require('../middleware/multer');

/**
 * @openapi
 * /tickets/{id}/attachments:
 *   get:
 *     tags: [Attachments]
 *     summary: List attachments for a ticket
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attachments list
 */
router.get('/', verifyToken, (req, res, next) => controller.list(req, res, next).catch(next));

/**
 * @openapi
 * /tickets/{id}/attachments:
 *   post:
 *     tags: [Attachments]
 *     summary: Upload an attachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Attachment uploaded
 */
router.post('/', verifyToken, upload.single('file'), (req, res, next) => controller.upload(req, res, next).catch(next));

/**
 * @openapi
 * /tickets/{id}/attachments/{attachmentId}:
 *   delete:
 *     tags: [Attachments]
 *     summary: Delete an attachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Attachment deleted
 */
router.delete('/:attachmentId', verifyToken, (req, res, next) => controller.delete(req, res, next).catch(next));

router.handleGetFile = (req, res, next) => controller.get(req, res, next).catch(next);

module.exports = router;
