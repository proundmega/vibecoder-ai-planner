const express = require('express');
const router = express.Router();
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { forProjectParam } = require('../middleware/agentProjectScope');
const { requireRuntime, requireProjectGrant } = require('../middleware/agentRole');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate, validatePathParams } = require('../middleware/validate');
const gitController = require('../controllers/gitController');
const { connectRepoSchema, reviewRequestSchema, idPathParam } = require('../validators/git');
const { tokenRequestSchema } = require('../validators/github');

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
router.get('/:projectId/repos', verifyToken, validatePathParams({ projectId: idPathParam }), gitController.listRepos);

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
router.get('/:projectId/repo', verifyToken, validatePathParams({ projectId: idPathParam }), gitController.getRepoStatus);

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
  validatePathParams({ projectId: idPathParam }),
  requireRuntime('running'),
  forProjectParam(),
  requireProjectGrant('worker'),
  gitController.getRepoForAgent
);

/**
 * @openapi
 * /git/{projectId}/token:
 *   post:
 *     tags: [Git]
 *     summary: Mint or return the provider-scoped Git credential for the agent
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { $ref: '#/components/schemas/NumericId' }
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Token, mode, expiry and provider
 */
router.post(
  '/:projectId/token',
  verifyTokenOrAgent,
  validatePathParams({ projectId: idPathParam }),
  requireRuntime('running'),
  forProjectParam(),
  requireProjectGrant('worker'),
  validate(tokenRequestSchema),
  gitController.requestToken
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
 *               accessToken: { type: string, description: 'GitHub-compatible alias for token' }
 *               sshKey: { type: string }
 *     responses:
 *       201:
 *         description: Repository connected
 */
router.post(
  '/:projectId/repo/connect',
  verifyToken,
  validatePathParams({ projectId: idPathParam }),
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
  validatePathParams({ projectId: idPathParam }),
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
router.get('/:projectId/branches', verifyToken, validatePathParams({ projectId: idPathParam }), gitController.listBranches);

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
router.get('/:projectId/reviews', verifyToken, validatePathParams({ projectId: idPathParam }), gitController.listReviews);

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
router.post('/:ticketId/branch', verifyToken, validatePathParams({ ticketId: idPathParam }), gitController.createBranch);
router.delete('/:ticketId/branch', verifyToken, validatePathParams({ ticketId: idPathParam }), gitController.deleteBranch);

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
  validatePathParams({ ticketId: idPathParam }),
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
router.get('/:ticketId/review/diff', verifyToken, validatePathParams({ ticketId: idPathParam }), gitController.getReviewDiff);

module.exports = router;
