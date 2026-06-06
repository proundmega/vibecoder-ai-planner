const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireActiveUser } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createUserSchema, updateUserSchema } = require('../validators/users');
const userController = require('../controllers/userController');

// List users (project_admin: own users, member: own users, super_admin: all users)
router.get('/', verifyToken, requireActiveUser, userController.listUsers);

// Create user (project_admin: member/user, member: user only)
router.post('/', verifyToken, requireRole('project_admin', 'member'), validate(createUserSchema), userController.createUser);

// Update user (project_admin: all, member: user only)
// Note: role is IMMUABLE — cannot be changed after assignment
router.put('/:id', verifyToken, requireActiveUser, validate(updateUserSchema), userController.updateUser);

// Deactivate/activate user
router.patch('/:id/toggle-active', verifyToken, requireRole('project_admin', 'super_admin'), userController.toggleUserActive);

// Delete user
router.delete('/:id', verifyToken, requireRole('project_admin', 'super_admin'), userController.deleteUser);

// Super admin: list ALL users (no project scoping)
router.get('/super-admin', verifyToken, requireRole('super_admin'), userController.listAllUsers);

module.exports = router;
