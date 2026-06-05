const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireActiveUser } = require('../middleware/auth');
const UserService = require('../services/UserService');

// List users (project_admin: own users, member: own users, super_admin: all users)
router.get('/', verifyToken, requireActiveUser, async (req, res) => {
  try {
    const { role, search, page, perPage } = req.query;
    const users = await UserService.listUsers(req.user.userId, req.user.role, { role, search, page, perPage });
    res.json({ users });
  } catch (error) {
    console.error('GET /api/users', error);
    res.status(500).json({ error: error.message });
  }
});

// Create user (project_admin: member/user, member: user only)
router.post('/', verifyToken, requireRole('project_admin', 'member'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields: name, email, password, role' });
    }
    
    const user = await UserService.createUser(name, email, password, role, req.user.userId);
    res.status(201).json(user);
  } catch (error) {
    console.error('POST /api/users', error);
    res.status(400).json({ error: error.message });
  }
});

// Update user (project_admin: all, member: user only)
// Note: role is IMMUABLE — cannot be changed after assignment
router.put('/:id', verifyToken, requireActiveUser, async (req, res) => {
  try {
    const { name, is_active } = req.body;
    
    const user = await UserService.updateUser(req.params.id, req.user.userId, { name, is_active });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('PUT /api/users/:id', error);
    res.status(400).json({ error: error.message });
  }
});

// Deactivate/activate user
router.patch('/:id/toggle-active', verifyToken, requireRole('project_admin', 'super_admin'), async (req, res) => {
  try {
    const user = await UserService.toggleUserActive(req.params.id, req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('PATCH /api/users/:id/toggle-active', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete user
router.delete('/:id', verifyToken, requireRole('project_admin', 'super_admin'), async (req, res) => {
  try {
    await UserService.deleteUser(req.params.id, req.user.userId);
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('DELETE /api/users/:id', error);
    res.status(400).json({ error: error.message });
  }
});

// Super admin: list ALL users (no project scoping)
router.get('/super-admin', verifyToken, requireRole('super_admin'), async (req, res) => {
  try {
    const { search, role, is_active, page, perPage } = req.query;
    const users = await UserService.listAllUsers({ search, role, is_active, page, perPage });
    res.json({ users });
  } catch (error) {
    console.error('GET /api/users/super-admin', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
