const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const githubController = require('../controllers/githubController');
const {
  connectRepoSchema,
  createBranchSchema,
  createPRSchema,
  installationSchema,
  tokenRequestSchema,
} = require('../validators/github');

/**
 * @openapi
 * /github/{projectId}/repo:
 *   get:
 *     tags: [GitHub]
 *     summary: Get repository connection status
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Repository status
 */
router.get('/:projectId/repo', verifyToken, githubController.getRepoStatus);

/**
 * @openapi
 * /github/{projectId}/repo/agent:
 *   get:
 *     tags: [GitHub]
 *     summary: Get repository connection for the agent (App mode returns no token)
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Repository config; `accessToken` is present only in explicit PAT mode
 */
router.get('/:projectId/repo/agent', verifyTokenOrAgent, githubController.getRepoForAgent);

/**
 * @openapi
 * /github/{projectId}/token:
 *   post:
 *     tags: [GitHub]
 *     summary: Mint a short-lived, repo-scoped GitHub token for the agent
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: GitHub token and expiry
 *       403:
 *         description: GitHub access is disabled or not configured
 */
router.post('/:projectId/token', verifyTokenOrAgent, validate(tokenRequestSchema), githubController.requestToken);

/**
 * @openapi
 * /github/{projectId}/installation:
 *   get:
 *     tags: [GitHub]
 *     summary: Get the GitHub App installation mapping for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Installation mapping or null
 */
router.get('/:projectId/installation', verifyToken, githubController.getInstallationStatus);

/**
 * @openapi
 * /github/{projectId}/installation:
 *   put:
 *     tags: [GitHub]
 *     summary: Map a project to a GitHub App installation and repo allowlist
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Updated installation mapping
 */
router.put('/:projectId/installation', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(installationSchema), githubController.setInstallation);

/**
 * @openapi
 * /github/{projectId}/installation:
 *   delete:
 *     tags: [GitHub]
 *     summary: Disable GitHub App access and revoke cached tokens for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Access disabled
 */
router.delete('/:projectId/installation', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), githubController.disableInstallation);

/**
 * @openapi
 * /github/{projectId}/repo/connect:
 *   post:
 *     tags: [GitHub]
 *     summary: Connect repository to project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               repoUrl: { type: string }
 *               branch: { type: string }
 *     responses:
 *       200:
 *         description: Repository connected
 */
router.post('/:projectId/repo/connect', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), validate(connectRepoSchema), githubController.connectRepo);

/**
 * @openapi
 * /github/{projectId}/repo:
 *   delete:
 *     tags: [GitHub]
 *     summary: Disconnect repository
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Repository disconnected
 */
router.delete('/:projectId/repo', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), githubController.disconnectRepo);

/**
 * @openapi
 * /github/{projectId}/branches:
 *   get:
 *     tags: [GitHub]
 *     summary: List branches for project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: List of branches
 */
router.get('/:projectId/branches', verifyToken, githubController.listBranches);

/**
 * @openapi
 * /github/{ticketId}/branch:
 *   post:
 *     tags: [GitHub]
 *     summary: Create branch for ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Branch created
 */
router.post('/:ticketId/branch', verifyToken, validate(createBranchSchema), githubController.createBranch);

/**
 * @openapi
 * /github/{ticketId}/branch:
 *   delete:
 *     tags: [GitHub]
 *     summary: Delete branch for ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Branch deleted
 */
router.delete('/:ticketId/branch', verifyToken, githubController.deleteBranch);

/**
 * @openapi
 * /github/{projectId}/prs:
 *   get:
 *     tags: [GitHub]
 *     summary: List pull requests for project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: List of PRs
 */
router.get('/:projectId/prs', verifyToken, githubController.listPRs);

/**
 * @openapi
 * /github/{ticketId}/pr:
 *   post:
 *     tags: [GitHub]
 *     summary: Create pull request for ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: PR created
 */
router.post('/:ticketId/pr', verifyToken, validate(createPRSchema), githubController.createPR);

module.exports = router;
