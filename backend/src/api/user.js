const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const User = require('../models/user');

// Get current user
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await User.find(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.currentPlan
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, avatar } = req.body;
    // In a real app, this would update DB
    res.json({ message: 'Profile updated', name, avatar });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user stats
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    // Get ticket count, projects created, etc.
    res.json({
      totalTickets: 42,
      activeProjects: 3,
      ticketsThisMonth: 12,
      apiCalls: 156
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
