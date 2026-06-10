const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const credentialController = require('../controllers/credentialController');

// List credentials for a project
router.get('/:projectId/credentials', verifyToken, credentialController.listCredentials);

// Add a new credential
router.post('/:projectId/credentials', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.addCredential);

// Update a credential
router.patch('/:projectId/credentials/:credentialId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.updateCredential);

// Delete (deactivate) a credential
router.delete('/:projectId/credentials/:credentialId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.deleteCredential);

// Rotate a credential
router.post('/:projectId/credentials/:credentialId/rotate', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.rotateCredential);

// Get decrypted key for agent use (internal)
router.get('/:projectId/credentials/decrypt', verifyToken, credentialController.getDecryptedKey);

module.exports = router;
