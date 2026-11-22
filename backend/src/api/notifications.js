const express = require('express');
const router = express.Router();
const NotificationService = require('../services/NotificationService');
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { notificationListQuerySchema } = require('../validators/questions');
const { ForbiddenError } = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Per-user in-app notifications (fg-55).
 *
 * Every route is scoped to the JWT user; an agent credential is rejected so a
 * runtime cannot read or clear an operator's bell.
 */

function userIdOf(req) {
  const id = req.user?.userId || req.user?.id;
  if (!id) {
    throw new ForbiddenError('Operator JWT required');
  }
  return id;
}

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List notifications for the current user
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unread
 *         schema: { type: boolean }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0 }
 *     responses:
 *       200:
 *         description: Notification rows newest first
 */
router.get('/', verifyToken, validate({ query: notificationListQuerySchema }), async (req, res, next) => {
  try {
    const rows = await NotificationService.listForUser(userIdOf(req), req.query);
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('GET /notifications failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Unread notification count for the bell
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 */
router.get('/unread-count', verifyToken, async (req, res, next) => {
  try {
    const count = await NotificationService.unreadCount(userIdOf(req));
    res.json({ success: true, data: { count } });
  } catch (error) {
    logger.error('GET /notifications/unread-count failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark every notification read
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Number of rows marked read
 */
router.post('/read-all', verifyToken, async (req, res, next) => {
  try {
    const updated = await NotificationService.markAllRead(userIdOf(req));
    res.json({ success: true, data: { updated } });
  } catch (error) {
    logger.error('POST /notifications/read-all failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /notifications/{id}/read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark one notification read
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Updated notification
 *       404:
 *         description: Notification not found for this user
 */
router.post('/:id/read', verifyToken, async (req, res, next) => {
  try {
    const row = await NotificationService.markRead(userIdOf(req), req.params.id);
    res.json({ success: true, data: row });
  } catch (error) {
    logger.error('POST /notifications/:id/read failed:', error);
    next(error);
  }
});

module.exports = router;
