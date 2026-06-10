const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const githubController = require('../controllers/githubController');

// Project repository management
router.get('/:projectId/repo', verifyToken, githubController.getRepoStatus);
router.post('/:projectId/repo/connect', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), githubController.connectRepo);
router.delete('/:projectId/repo', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), githubController.disconnectRepo);

// Ticket branch management
router.get('/:projectId/branches', verifyToken, githubController.listBranches);
router.post('/:ticketId/branch', verifyToken, githubController.createBranch);
router.delete('/:ticketId/branch', verifyToken, githubController.deleteBranch);

// Ticket PR management
router.get('/:projectId/prs', verifyToken, githubController.listPRs);
router.post('/:ticketId/pr', verifyToken, githubController.createPR);

module.exports = router;
