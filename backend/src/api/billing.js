const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const billingController = require('../controllers/billingController');

// Get billing for a project
router.get('/projects/:id/billing', verifyToken, billingController.getProjectBilling);

// Get billing for current user
router.get('/users/me/billing', verifyToken, billingController.getUserBilling);

module.exports = router;
