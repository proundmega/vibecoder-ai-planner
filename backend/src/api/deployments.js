const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { createEnvironmentSchema, triggerDeploySchema, updateDeploymentStatusSchema } = require('../validators/deployments');
const DeployService = require('../services/DeployService');

router.get('/projects/:projectId/environments', verifyToken, async (req, res, next) => {
  try {
    const envs = await DeployService.listEnvironments(req.params.projectId);
    res.json({ success: true, data: envs });
  } catch (err) { next(err); }
});

router.post('/projects/:projectId/environments', verifyToken, requireAnyPermission('PROJECT_ADMIN'), validate(createEnvironmentSchema), async (req, res, next) => {
  try {
    const env = await DeployService.createEnvironment(req.params.projectId, req.body.name, req.body.webhook_url, req.body.branch_pattern);
    res.status(201).json({ success: true, data: env });
  } catch (err) { next(err); }
});

router.delete('/environments/:id', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    await DeployService.deleteEnvironment(req.params.id);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

router.post('/tickets/:ticketId/deploy', verifyToken, validate(triggerDeploySchema), async (req, res, next) => {
  try {
    const dep = await DeployService.triggerDeploy(req.params.ticketId, req.body.environment_id);
    res.json({ success: true, data: dep });
  } catch (err) { next(err); }
});

router.post('/deployments/:id/rollback', verifyToken, async (req, res, next) => {
  try {
    await DeployService.rollbackDeployment(req.params.id);
    res.json({ success: true, data: { rolled_back: true } });
  } catch (err) { next(err); }
});

router.patch('/deployments/:id/status', verifyToken, validate(updateDeploymentStatusSchema), async (req, res, next) => {
  try {
    const dep = await DeployService.updateDeploymentStatus(req.params.id, req.body.status);
    res.json({ success: true, data: dep });
  } catch (err) { next(err); }
});

router.get('/tickets/:ticketId/deployments', verifyToken, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const history = await DeployService.getDeploymentHistory(req.params.ticketId, limit, offset);
    res.json({ success: true, data: history });
  } catch (err) { next(err); }
});

module.exports = router;
