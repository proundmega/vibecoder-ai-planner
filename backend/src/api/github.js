const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const githubController = require('../controllers/githubController');

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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Repository status
 */
router.get('/:projectId/repo', verifyToken, githubController.getRepoStatus);

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
 *         schema: { type: string, format: uuid }
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
router.post('/:projectId/repo/connect', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), githubController.connectRepo);

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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Branch created
 */
router.post('/:ticketId/branch', verifyToken, githubController.createBranch);

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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
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
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PR created
 */
router.post('/:ticketId/pr', verifyToken, githubController.createPR);

module.exports = router;
