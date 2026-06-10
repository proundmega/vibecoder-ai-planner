const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const providerController = require('../controllers/providerController');

// List all providers for a project
router.get('/:projectId/providers', verifyToken, providerController.listProviders);

// Add a new provider
router.post('/:projectId/providers', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), providerController.addProvider);

// Update a provider
router.patch('/:projectId/providers/:providerId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), providerController.updateProvider);

// Delete a provider
router.delete('/:projectId/providers/:providerId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), providerController.deleteProvider);

// Test provider connection
router.post('/:projectId/providers/:providerId/test', verifyToken, providerController.testProvider);

module.exports = router;
