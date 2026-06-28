const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { createMilestoneSchema, updateMilestoneSchema } = require('../validators/milestones');
const MilestoneService = require('../services/MilestoneService');

router.get('/projects/:projectId/milestones', verifyToken, async (req, res, next) => {
  try {
    const milestones = await MilestoneService.list(req.params.projectId);
    res.json({ success: true, data: milestones });
  } catch (err) { next(err); }
});

router.post('/projects/:projectId/milestones', verifyToken, requireAnyPermission('PROJECT_UPDATE'), validate(createMilestoneSchema), async (req, res, next) => {
  try {
    const milestone = await MilestoneService.create(req.params.projectId, req.body);
    res.status(201).json({ success: true, data: milestone });
  } catch (err) { next(err); }
});

router.put('/milestones/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), validate(updateMilestoneSchema), async (req, res, next) => {
  try {
    const milestone = await MilestoneService.update(req.params.id, req.body);
    res.json({ success: true, data: milestone });
  } catch (err) { next(err); }
});

router.get('/milestones/:id/tickets', verifyToken, async (req, res, next) => {
  try {
    const tickets = await MilestoneService.getTickets(req.params.id);
    res.json({ success: true, data: tickets });
  } catch (err) { next(err); }
});

router.get('/milestones/:id/progress', verifyToken, async (req, res, next) => {
  try {
    const progress = await MilestoneService.getProgress(req.params.id);
    res.json({ success: true, data: progress });
  } catch (err) { next(err); }
});

module.exports = router;
