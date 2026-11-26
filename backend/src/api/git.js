const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { forProjectParam } = require('../middleware/agentProjectScope');
const { requireRuntime, requireProjectGrant } = require('../middleware/agentRole');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const gitController = require('../controllers/gitController');
const { connectRepoSchema, reviewRequestSchema } = require('../validators/git');

/**
 * @openapi
 * /git/providers:
 *   get:
 *     tags: [Git]
 *     summary: List Git providers and their capabilities
 *     responses:
 *       200:
 *         description: Providers with capability flags and registration state
 */
router.get('/providers', verifyToken, gitController.listProviders);

/**
 * @openapi
 * /git/{projectId}/repos:
 *   get:
 *     tags: [Git]
 *     summary: List repository connections for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     responses:
 *       200:
 *         description: Repository connections
 */
router.get('/:projectId/repos', verifyToken, gitController.listRepos);

/**
 * @openapi
 * /git/{projectId}/repo:
 *   get:
 *     tags: [Git]
 *     summary: Get repository connection status
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: provider
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Repository status or null
 */
router.get('/:projectId/repo', verifyToken, gitController.getRepoStatus);

/**
 * @openapi
 * /git/{projectId}/repo/agent:
 *   get:
 *     tags: [Git]
 *     summary: Get the provider-scoped repository credential for the agent
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Provider, clone URL, auth mode and credential (or SSH key)
 */
router.get(
  '/:projectId/repo/agent',
  verifyTokenOrAgent,
  requireRuntime('running'),
  forProjectParam(),
  requireProjectGrant('worker'),
  gitController.getRepoForAgent
);

/**
 * @openapi
 * /git/{projectId}/repo/connect:
 *   post:
 *     tags: [Git]
 *     summary: Connect a repository using any registered provider
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
 *             required: [repoUrl]
 *             properties:
 *               provider: { type: string }
 *               repoUrl: { type: string }
 *               baseUrl: { type: string }
 *               authMode: { type: string }
 *               token: { type: string }
 *               sshKey: { type: string }
 *     responses:
 *       201:
 *         description: Repository connected
 */
router.post(
  '/:projectId/repo/connect',
  verifyToken,
  requireAnyPermission('PROJECT_MANAGE_MEMBERS'),
  validate(connectRepoSchema),
  gitController.connectRepo
);

/**
 * @openapi
 * /git/{projectId}/repo:
 *   delete:
 *     tags: [Git]
 *     summary: Disconnect a repository (optionally scoped to one provider)
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *       - in: query
 *         name: provider
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Repository disconnected
 */
router.delete(
  '/:projectId/repo',
  verifyToken,
  requireAnyPermission('PROJECT_MANAGE_MEMBERS'),
  gitController.disconnectRepo
);

/**
 * @openapi
 * /git/{projectId}/branches:
 *   get:
 *     tags: [Git]
 *     summary: List ticket branches for a project
 *     responses:
 *       200:
 *         description: Branch names
 */
router.get('/:projectId/branches', verifyToken, gitController.listBranches);

/**
 * @openapi
 * /git/{projectId}/reviews:
 *   get:
 *     tags: [Git]
 *     summary: List open review requests for a project
 *     responses:
 *       200:
 *         description: Review requests
 */
router.get('/:projectId/reviews', verifyToken, gitController.listReviews);

/**
 * @openapi
 * /git/{ticketId}/branch:
 *   post:
 *     tags: [Git]
 *     summary: Create the ticket branch through the connected provider
 *     responses:
 *       201:
 *         description: Branch created
 *   delete:
 *     tags: [Git]
 *     summary: Delete the ticket branch
 *     responses:
 *       200:
 *         description: Branch deleted
 */
router.post('/:ticketId/branch', verifyToken, gitController.createBranch);
router.delete('/:ticketId/branch', verifyToken, gitController.deleteBranch);

/**
 * @openapi
 * /git/{ticketId}/review:
 *   post:
 *     tags: [Git]
 *     summary: Create or reuse the ticket review request
 *     responses:
 *       201:
 *         description: Review request created or reused
 */
router.post(
  '/:ticketId/review',
  verifyToken,
  validate(reviewRequestSchema),
  gitController.createReview
);

/**
 * @openapi
 * /git/{ticketId}/review/diff:
 *   get:
 *     tags: [Git]
 *     summary: Read the ticket review diff
 *     responses:
 *       200:
 *         description: Review files
 */
router.get('/:ticketId/review/diff', verifyToken, gitController.getReviewDiff);

module.exports = router;
