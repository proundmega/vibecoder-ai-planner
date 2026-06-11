const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const memoryController = require('../controllers/memoryController');

// Get memories for a project
router.get('/project/:projectId', verifyToken, memoryController.getProjectMemory);

// Search memories in a project
router.get('/project/:projectId/search', verifyToken, memoryController.searchMemory);

// Get memories for a specific agent
router.get('/agent/:agentId', verifyToken, memoryController.getAgentMemory);

// Add memory to a project
router.post('/project/:projectId', verifyToken, memoryController.addMemory);

// Get a specific memory
router.get('/:id', verifyToken, memoryController.getMemory);

// Update a memory
router.put('/:id', verifyToken, memoryController.updateMemory);

// Delete a memory
router.delete('/:id', verifyToken, memoryController.deleteMemory);

module.exports = router;
