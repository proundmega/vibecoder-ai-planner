const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const credentialController = require('../controllers/credentialController');
const { addCredentialSchema, updateCredentialSchema } = require('../validators/credentials');

/**
 * @openapi
 * /credentials/{projectId}/credentials:
 *   get:
 *     tags: [Credentials]
 *     summary: List credentials for project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of credentials
 */
router.get('/:projectId/credentials', verifyToken, credentialController.listCredentials);

/**
 * @openapi
 * /credentials/{projectId}/credentials:
 *   post:
 *     tags: [Credentials]
 *     summary: Add credential to project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               credential: { type: string }
 *     responses:
 *       201:
 *         description: Credential added
 */
router.post('/:projectId/credentials', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(addCredentialSchema), credentialController.addCredential);

/**
 * @openapi
 * /credentials/{projectId}/credentials/{credentialId}:
 *   patch:
 *     tags: [Credentials]
 *     summary: Update credential
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: credentialId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               credential: { type: string }
 *     responses:
 *       200:
 *         description: Credential updated
 */
router.patch('/:projectId/credentials/:credentialId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(updateCredentialSchema), credentialController.updateCredential);

/**
 * @openapi
 * /credentials/{projectId}/credentials/{credentialId}:
 *   delete:
 *     tags: [Credentials]
 *     summary: Delete (deactivate) credential
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: credentialId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Credential deleted
 */
router.delete('/:projectId/credentials/:credentialId', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.deleteCredential);

/**
 * @openapi
 * /credentials/{projectId}/credentials/{credentialId}/rotate:
 *   post:
 *     tags: [Credentials]
 *     summary: Rotate credential
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: credentialId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Credential rotated
 */
router.post('/:projectId/credentials/:credentialId/rotate', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), credentialController.rotateCredential);

/**
 * @openapi
 * /credentials/{projectId}/credentials/decrypt:
 *   get:
 *     tags: [Credentials]
 *     summary: Get decrypted key for agent use
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Decrypted key
 */
router.get('/:projectId/credentials/decrypt', verifyToken, credentialController.getDecryptedKey);

module.exports = router;
