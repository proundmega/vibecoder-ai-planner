const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const usageController = require('../controllers/usageController');

// Get usage for a project
router.get('/projects/:id/usage', verifyToken, usageController.getProjectUsage);

// Get usage for current user
router.get('/users/me/usage', verifyToken, usageController.getUserUsage);

// Get model pricing info
router.get('/pricing/models', verifyToken, usageController.getModelPricing);

module.exports = router;
