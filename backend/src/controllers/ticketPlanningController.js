const TicketPlanningService = require('../services/TicketPlanningService');
// HttpError imported for type reference

class TicketPlanningController {
  async list(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.userId;
    
    const files = await TicketPlanningService.list(ticketId, userId);
    res.json({ success: true, data: files });
  }

  async get(req, res) {
    const { ticketId, fileKey } = req.params;
    const userId = req.user.userId;
    
    const file = await TicketPlanningService.get(ticketId, fileKey, userId);
    if (!file) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Planning file not found' } });
    }
    res.json({ success: true, data: file });
  }

  async upsert(req, res) {
    const { ticketId, fileKey } = req.params;
    const userId = req.user.userId;
    const { content } = req.body;
    
    if (!content && content !== '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Content is required' } });
    }

    const file = await TicketPlanningService.upsert(ticketId, fileKey, content, userId);
    res.json({ success: true, data: file });
  }

  async applyTemplate(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.userId;
    const { templateName } = req.body;
    
    if (!templateName) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'templateName is required' } });
    }

    const files = await TicketPlanningService.applyTemplate(ticketId, templateName, userId);
    res.json({ success: true, data: files, message: 'Template applied successfully' });
  }

  async updateStatus(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.userId;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status is required' } });
    }

    await TicketPlanningService.updateStatus(ticketId, status, userId);
    res.json({ success: true, data: { status }, message: 'Planning status updated' });
  }
}

module.exports = new TicketPlanningController();
