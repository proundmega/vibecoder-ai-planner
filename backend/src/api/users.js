const express = require('express');
const router = express.Router();
const { verifyToken, requireActiveUser } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { createUserSchema, updateUserSchema } = require('../validators/users');
const userController = require('../controllers/userController');

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users for current project
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: perPage
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     users:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 */
router.get('/', verifyToken, requireActiveUser, userController.listUsers);

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string }
 *               role: { type: string, enum: [user, member, project_admin, super_admin] }
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Validation error
 */
router.post('/', verifyToken, requireAnyPermission('USER_CREATE'), validate(createUserSchema), userController.createUser);

/**
 * @openapi
 * /users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Update user
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
 *               is_active: { type: boolean }
 *     responses:
 *       200:
 *         description: User updated
 *       404:
 *         description: User not found
 */
router.put('/:id', verifyToken, requireActiveUser, validate(updateUserSchema), userController.updateUser);

/**
 * @openapi
 * /users/{id}/toggle-active:
 *   patch:
 *     tags: [Users]
 *     summary: Toggle user active status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User status toggled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.patch('/:id/toggle-active', verifyToken, requireAnyPermission('USER_TOGGLE_ACTIVE'), userController.toggleUserActive);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete user (soft delete)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User deleted
 *       404:
 *         description: User not found
 */
router.delete('/:id', verifyToken, requireAnyPermission('USER_DELETE'), userController.deleteUser);

/**
 * @openapi
 * /users/super-admin:
 *   get:
 *     tags: [Users]
 *     summary: List all users (super admin only)
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: is_active
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: perPage
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of all users
 *       403:
 *         description: Forbidden - super admin only
 */
router.get('/super-admin', verifyToken, requireAnyPermission('USER_VIEW_ALL'), userController.listAllUsers);

/**
 * @openapi
 * /users/{id}/unlock:
 *   post:
 *     tags: [Users]
 *     summary: Unlock a locked user account (super admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: User unlocked successfully
 *       403:
 *         description: Forbidden - super admin only
 *       404:
 *         description: User not found
 */
router.post('/:id/unlock', verifyToken, requireAnyPermission('USER_UPDATE'), userController.unlockUser);

module.exports = router;
