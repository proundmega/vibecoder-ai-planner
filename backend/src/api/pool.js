const express = require('express');
const router = express.Router();
const poolManager = require('../services/PoolManager');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { requestAgentSchema, releaseAgentSchema } = require('../validators/pool');

router.post('/pool/request', verifyToken, requireAnyPermission('PROJECT_ADMIN'), validate(requestAgentSchema), async (req, res, next) => {
  try {
    const { project_id, repo_url, provider_config } = req.body;
    const result = await poolManager.requestAgent(project_id, repo_url, provider_config || {});
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/pool/release', verifyToken, requireAnyPermission('PROJECT_ADMIN'), validate(releaseAgentSchema), async (req, res, next) => {
  try {
    const { agent_id } = req.body;
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
