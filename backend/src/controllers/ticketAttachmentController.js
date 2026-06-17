const TicketAttachmentService = require('../services/TicketAttachmentService');
const { NotFoundError, ForbiddenError } = require('../errors/HttpError');
const path = require('path');
const fs = require('fs');

class TicketAttachmentController {
  async upload(req, res) {
    const { id: ticketId } = req.params;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
    }

    if (req.file.error) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: req.file.error.message } });
    }

    const attachment = await TicketAttachmentService.upload(ticketId, req.file, userId);
    res.status(201).json({ success: true, data: attachment, message: 'Attachment uploaded successfully' });
  }

  async list(req, res) {
    const { id: ticketId } = req.params;
    const userId = req.user.userId;

    const attachments = await TicketAttachmentService.list(ticketId, userId);
    res.json({ success: true, data: attachments });
  }

  async get(req, res) {
    const { id: attachmentId } = req.params;
    const { ticketId } = req.query;
    const userId = req.user.userId;

    const attachment = await TicketAttachmentService.get(attachmentId, ticketId, userId);
    if (!attachment) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
    }

    const filePath = path.join(__dirname, '../../uploads/tickets', ticketId.toString(), path.basename(attachment.stored_path));
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found on disk' } });
    }

    res.sendFile(filePath);
  }

  async delete(req, res) {
    const { id: ticketId, attachmentId } = req.params;
    const userId = req.user.userId;

    await TicketAttachmentService.delete(attachmentId, ticketId, userId);
    res.json({ success: true, message: 'Attachment deleted successfully' });
  }
}

module.exports = new TicketAttachmentController();
