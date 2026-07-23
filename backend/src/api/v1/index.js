const express = require('express');
const router = express.Router();

const userRouter = require('../user');
const usersManagementRouter = require('../users');
const projectsRouter = require('../projects');
const ticketsRouter = require('../tickets');
const pricingRouter = require('../pricing');
const agentsRouter = require('../agents');
const approvalsRouter = require('../approvals');
const permissionsRouter = require('../permissions');
const githubRouter = require('../github');
const providersRouter = require('../providers');
const credentialsRouter = require('../credentials');
const usageRouter = require('../usage');
const billingRouter = require('../billing');
const memoryRouter = require('../memory');
const reviewRouter = require('../review');
const ticketPlanningController = require('../../controllers/ticketPlanningController');
const ticketAttachmentController = require('../../controllers/ticketAttachmentController');
const templateController = require('../../controllers/templateController');
const ticketAttachmentUpload = require('../../middleware/multer');
const { verifyToken } = require('../../middleware/auth');
const { requireAnyPermission } = require('../../middleware/permissions');
const { pool } = require('../../db');
const agentHeartbeatRouter = require('./agentHeartbeat');
const IpWhitelistService = require('../../services/IpWhitelistService');

// Template routes (under /projects/:projectId/templates) — must be before router.use('/projects')
router.get('/projects/:projectId/templates', verifyToken, requireAnyPermission('TICKET_UPDATE'), (req, res, next) => templateController.listTemplates(req, res, next).catch(next));
router.post('/projects/:projectId/templates', verifyToken, requireAnyPermission('TICKET_UPDATE'), (req, res, next) => templateController.createTemplate(req, res, next).catch(next));
router.put('/projects/:projectId/templates/:templateId', verifyToken, requireAnyPermission('TICKET_UPDATE'), (req, res, next) => templateController.updateTemplate(req, res, next).catch(next));
router.delete('/projects/:projectId/templates/:templateId', verifyToken, requireAnyPermission('TICKET_UPDATE'), (req, res, next) => templateController.deleteTemplate(req, res, next).catch(next));

// Attachment routes — must be before router.use('/tickets')
router.post('/tickets/:ticketId/attachments', verifyToken, ticketAttachmentUpload.single('file'), (req, res, next) => ticketAttachmentController.upload(req, res, next).catch(next));
router.get('/tickets/:ticketId/attachments', verifyToken, (req, res, next) => ticketAttachmentController.list(req, res, next).catch(next));
router.delete('/tickets/:ticketId/attachments/:attachmentId', verifyToken, (req, res, next) => ticketAttachmentController.delete(req, res, next).catch(next));
router.get('/attachments/:attachmentId', verifyToken, (req, res, next) => ticketAttachmentController.get(req, res, next).catch(next));

// Planning routes (inlined to preserve ticketId param)
router.get('/tickets/:ticketId/planning', verifyToken, (req, res, next) => ticketPlanningController.list(req, res, next).catch(next));
router.get('/tickets/:ticketId/planning/:fileKey', verifyToken, (req, res, next) => ticketPlanningController.get(req, res, next).catch(next));
router.put('/tickets/:ticketId/planning/:fileKey', verifyToken, (req, res, next) => ticketPlanningController.upsert(req, res, next).catch(next));
router.post('/tickets/:ticketId/planning/apply-template', verifyToken, (req, res, next) => ticketPlanningController.applyTemplate(req, res, next).catch(next));
router.patch('/tickets/:ticketId/planning/status', verifyToken, (req, res, next) => ticketPlanningController.updateStatus(req, res, next).catch(next));

// Planning usage routes — aggregated per-stage and per-file
router.get('/tickets/:ticketId/planning/usage', verifyToken, requireAnyPermission('MEMBER', 'PROJECT_ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const ticketId = parseInt(req.params.ticketId);

    const ticketResult = await pool.query(
      'SELECT t.id, t.project_id, p.name as project_name FROM tickets t JOIN projects p ON t.project_id = p.id WHERE t.id = $1',
      [ticketId]
    );
    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }

    const stageResult = await pool.query(`
      SELECT planning_stage,
             COALESCE(SUM(tokens_in), 0) as total_tokens_in,
             COALESCE(SUM(tokens_out), 0) as total_tokens_out,
             COALESCE(SUM(cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(duration_ms), 0) as total_duration_ms,
             COUNT(*) as call_count
      FROM usage_logs
      WHERE ticket_id = $1 AND planning_stage IS NOT NULL
      GROUP BY planning_stage
      ORDER BY total_cost_usd DESC
    `, [ticketId]);

    const fileResult = await pool.query(`
      SELECT file_key,
             COALESCE(SUM(tokens_in), 0) as total_tokens_in,
             COALESCE(SUM(tokens_out), 0) as total_tokens_out,
             COALESCE(SUM(cost_usd), 0) as total_cost_usd
      FROM usage_logs
      WHERE ticket_id = $1 AND file_key IS NOT NULL
      GROUP BY file_key
      ORDER BY file_key
    `, [ticketId]);

    const byStage = {};
    for (const row of stageResult.rows) {
      byStage[row.planning_stage] = {
        tokensIn: parseInt(row.total_tokens_in),
        tokensOut: parseInt(row.total_tokens_out),
        costUsd: parseFloat(row.total_cost_usd),
        durationMs: parseInt(row.total_duration_ms),
        callCount: parseInt(row.call_count),
      };
    }

    const byFile = fileResult.rows.map(row => ({
      fileKey: row.file_key,
      tokensIn: parseInt(row.total_tokens_in),
      tokensOut: parseInt(row.total_tokens_out),
      costUsd: parseFloat(row.total_cost_usd),
    }));

    const totalCost = Object.values(byStage).reduce((sum, s) => sum + s.costUsd, 0);

    res.json({
      success: true,
      data: {
        ticketId,
        projectId: ticketResult.rows[0].project_id,
        projectName: ticketResult.rows[0].project_name,
        totalCost,
        totalTokensIn: Object.values(byStage).reduce((sum, s) => sum + s.tokensIn, 0),
        totalTokensOut: Object.values(byStage).reduce((sum, s) => sum + s.tokensOut, 0),
        totalDurationMs: Object.values(byStage).reduce((sum, s) => sum + s.durationMs, 0),
        byStage,
        byFile,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tickets/:ticketId/planning/:fileKey/usage', verifyToken, requireAnyPermission('MEMBER', 'PROJECT_ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const fileKey = decodeURIComponent(req.params.fileKey);

    const lastResult = await pool.query(`
      SELECT last_tokens_in, last_tokens_out, last_cost_usd, last_duration_ms,
             last_provider_type, last_model, last_planning_stage, last_ai_call_at
      FROM ticket_planning
      WHERE ticket_id = $1 AND file_key = $2
    `, [ticketId, fileKey]);

    const historyResult = await pool.query(`
      SELECT tokens_in, tokens_out, cost_usd, duration_ms,
             provider_type, model, planning_stage, created_at as at
      FROM usage_logs
      WHERE ticket_id = $1 AND file_key = $2
      ORDER BY created_at DESC
      LIMIT 50
    `, [ticketId, fileKey]);

    const lastUsage = lastResult.rows[0] ? {
      tokensIn: lastResult.rows[0].last_tokens_in || 0,
      tokensOut: lastResult.rows[0].last_tokens_out || 0,
      costUsd: parseFloat(lastResult.rows[0].last_cost_usd || 0),
      durationMs: lastResult.rows[0].last_duration_ms || 0,
      providerType: lastResult.rows[0].last_provider_type || null,
      model: lastResult.rows[0].last_model || null,
      planningStage: lastResult.rows[0].last_planning_stage || null,
      at: lastResult.rows[0].last_ai_call_at,
    } : null;

    const history = historyResult.rows.map(row => ({
      tokensIn: parseInt(row.tokens_in),
      tokensOut: parseInt(row.tokens_out),
      costUsd: parseFloat(row.cost_usd),
      durationMs: parseInt(row.duration_ms),
      providerType: row.provider_type,
      model: row.model,
      planningStage: row.planning_stage,
      at: row.at,
    }));

    res.json({
      success: true,
      data: {
        fileKey,
        lastUsage,
        history,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Mount all route modules under /v1
router.use('/users-management', userRouter);
router.use('/users', usersManagementRouter);
router.use('/projects', projectsRouter);
router.use('/tickets', ticketsRouter);
router.use('/pricing', pricingRouter);
router.use('/agents', agentsRouter);
router.use('/approvals', approvalsRouter);
router.use('/permissions', permissionsRouter);
router.use('/github', githubRouter);
router.use('/providers', providersRouter);
router.use('/credentials', credentialsRouter);
router.use('/usage', usageRouter);
router.use('/billing', billingRouter);
router.use('/memory', memoryRouter);
router.use('/tickets', reviewRouter);
router.use('/agents-status', agentHeartbeatRouter);

// IP Whitelist routes (super admin only)
router.get('/admin/ip-whitelist', verifyToken, requireAnyPermission('USER_VIEW_ALL'), async (req, res, next) => {
  try {
    const ips = await IpWhitelistService.list();
    res.json({ success: true, data: ips });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/ip-whitelist', verifyToken, requireAnyPermission('USER_UPDATE'), async (req, res, next) => {
  try {
    const { ip_address, description } = req.body;
    if (!ip_address) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_IP', message: 'ip_address is required' }
      });
    }
    const ip = await IpWhitelistService.create(ip_address, description, req.user.userId);
    res.status(201).json({ success: true, data: ip });
  } catch (error) {
    next(error);
  }
});

router.delete('/admin/ip-whitelist/:id', verifyToken, requireAnyPermission('USER_UPDATE'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await IpWhitelistService.delete(id);
    res.json({
      success: true,
      data: { ...result, message: 'IP removed from whitelist' }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
