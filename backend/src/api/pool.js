const express = require('express');
const router = express.Router();
const poolManager = require('../services/PoolManager');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');

router.post('/pool/request', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    const { project_id, repo_url, provider_config } = req.body;
    if (!project_id) {
      return res.status(400).json({ success: false, error: { message: 'project_id is required' } });
    }
    const result = await poolManager.requestAgent(project_id, repo_url, provider_config || {});
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/pool/release', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) {
      return res.status(400).json({ success: false, error: { message: 'agent_id is required' } });
    }
    await poolManager.releaseAgent(agent_id);
    res.json({ success: true, data: { released: true } });
  } catch (err) { next(err); }
});

router.get('/pool/status', verifyToken, async (req, res, next) => {
  try {
    const status = poolManager.getStatus();
    res.json({ success: true, data: status });
  } catch (err) { next(err); }
});

module.exports = router;
