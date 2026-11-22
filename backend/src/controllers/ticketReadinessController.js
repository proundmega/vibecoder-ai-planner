const TicketReadinessService = require('../services/TicketReadinessService');
const ProjectAccessService = require('../services/ProjectAccessService');

function actorFrom(req) {
  if (req.user && req.user.userId) {
    return { type: 'user', userId: req.user.userId, role: req.user.role };
  }
  if (req.agent) {
    return {
      type: 'agent',
      userId: req.user?.userId || null,
      agentId: req.agent.id,
      role: req.user?.role || 'agent',
    };
  }
  return { type: 'system', role: 'system' };
}

class TicketReadinessController {
  async get(req, res) {
    const readiness = await TicketReadinessService.getReadiness(req.params.ticketId);
    // The backend requires project membership for criteria writes. Surface the
    // same capability so the panel does not offer controls that return 403.
    let canEditCriteria = false;
    const userId = ProjectAccessService.actorUserId(req.user || {});
    if (userId && readiness.projectId) {
      canEditCriteria = await ProjectAccessService.isProjectMember(userId, readiness.projectId);
    }
    res.json({ success: true, data: { ...readiness, canEditCriteria } });
  }

  async approvePlan(req, res) {
    const readiness = await TicketReadinessService.approvePlan(req.params.ticketId, actorFrom(req));
    res.json({ success: true, data: readiness, message: 'Plan approved' });
  }

  async smallFix(req, res) {
    const readiness = await TicketReadinessService.smallFix(
      req.params.ticketId,
      req.body.reason,
      actorFrom(req)
    );
    res.json({ success: true, data: readiness, message: 'Small-fix exemption recorded' });
  }

  async replan(req, res) {
    const readiness = await TicketReadinessService.replan(req.params.ticketId, actorFrom(req));
    res.json({ success: true, data: readiness, message: 'Planning reopened' });
  }

  async override(req, res) {
    const readiness = await TicketReadinessService.override(
      req.params.ticketId,
      {
        codes: req.body.codes,
        reason: req.body.reason,
        expiresAt: req.body.expiresAt,
      },
      actorFrom(req)
    );
    res.json({ success: true, data: readiness, message: 'Readiness override granted' });
  }

  async revokeOverride(req, res) {
    const readiness = await TicketReadinessService.revokeOverride(
      req.params.ticketId,
      actorFrom(req)
    );
    res.json({ success: true, data: readiness, message: 'Readiness override revoked' });
  }

  async listCriteria(req, res) {
    const criteria = await TicketReadinessService.listCriteria(req.params.ticketId);
    res.json({ success: true, data: criteria });
  }

  async addCriteria(req, res) {
    const input = req.body.criteria !== undefined ? req.body.criteria : req.body;
    const criteria = await TicketReadinessService.addCriteria(
      req.params.ticketId,
      input,
      actorFrom(req)
    );
    res.status(201).json({ success: true, data: criteria });
  }

  async updateCriterion(req, res) {
    const criterion = await TicketReadinessService.updateCriterion(
      req.params.ticketId,
      req.params.criterionId,
      req.body,
      actorFrom(req)
    );
    res.json({ success: true, data: criterion });
  }

  async deleteCriterion(req, res) {
    const result = await TicketReadinessService.deleteCriterion(
      req.params.ticketId,
      req.params.criterionId,
      actorFrom(req)
    );
    res.json({ success: true, data: result });
  }
}

module.exports = new TicketReadinessController();
