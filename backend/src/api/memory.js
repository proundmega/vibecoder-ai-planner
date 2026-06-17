const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const memoryController = require('../controllers/memoryController');
const { addMemorySchema, updateMemorySchema } = require('../validators/memory');

/**
 * @openapi
 * /memory/project/{projectId}:
 *   get:
 *     tags: [Memory]
 *     summary: Get memories for a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of memories
 */
router.get('/project/:projectId', verifyToken, memoryController.getProjectMemory);

/**
 * @openapi
 * /memory/project/{projectId}/search:
 *   get:
 *     tags: [Memory]
 *     summary: Search memories in a project
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/project/:projectId/search', verifyToken, memoryController.searchMemory);

/**
 * @openapi
 * /memory/agent/{agentId}:
 *   get:
 *     tags: [Memory]
 *     summary: Get memories for an agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of agent memories
 */
router.get('/agent/:agentId', verifyToken, memoryController.getAgentMemory);

/**
 * @openapi
 * /memory/project/{projectId}:
 *   post:
 *     tags: [Memory]
 *     summary: Add memory to a project
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
 *               content: { type: string }
 *               metadata: { type: object }
 *     responses:
 *       201:
 *         description: Memory added
 */
router.post('/project/:projectId', verifyToken, validate(addMemorySchema), memoryController.addMemory);

/**
 * @openapi
 * /memory/{id}:
 *   get:
 *     tags: [Memory]
 *     summary: Get a specific memory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Memory details
 *       404:
 *         description: Memory not found
 */
router.get('/:id', verifyToken, memoryController.getMemory);

/**
 * @openapi
 * /memory/{id}:
 *   put:
 *     tags: [Memory]
 *     summary: Update a memory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content: { type: string }
 *               metadata: { type: object }
 *     responses:
 *       200:
 *         description: Memory updated
 */
router.put('/:id', verifyToken, validate(updateMemorySchema), memoryController.updateMemory);

/**
 * @openapi
 * /memory/{id}:
 *   delete:
 *     tags: [Memory]
 *     summary: Delete a memory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Memory deleted
 *       404:
 *         description: Memory not found
 */
router.delete('/:id', verifyToken, memoryController.deleteMemory);

module.exports = router;
