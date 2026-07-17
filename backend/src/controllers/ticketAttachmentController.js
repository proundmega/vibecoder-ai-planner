const TicketAttachmentService = require('../services/TicketAttachmentService');
// HttpError imported for type reference
const path = require('path');
const fs = require('fs');

class TicketAttachmentController {
  async upload(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
    }

    if (req.file.error) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: req.file.error.message } });
    }

    const attachment = await TicketAttachmentService.upload(ticketId, req.file, userId);
    // Strip stored_path — it reveals internal filesystem layout
    const { stored_path: _stored_path, ...safeAttachment } = attachment;
    res.status(201).json({ success: true, data: safeAttachment, message: 'Attachment uploaded successfully' });
  }

  async list(req, res) {
    const { ticketId } = req.params;
    const userId = req.user.userId;

    const attachments = await TicketAttachmentService.list(ticketId, userId);
    // Strip stored_path from each attachment — it reveals internal filesystem layout
    const safeAttachments = attachments.map(({ stored_path: _stored_path, ...safe }) => safe);
    res.json({ success: true, data: safeAttachments });
  }

  async get(req, res) {
    const { attachmentId } = req.params;
    const { ticketId } = req.query;
    const userId = req.user.userId;

    const attachment = await TicketAttachmentService.get(attachmentId, ticketId, userId);
    if (!attachment) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
    }

    const uploadDir = path.join(__dirname, '../../uploads/tickets');
    const filename = path.basename(attachment.stored_path);
    const filePath = path.resolve(uploadDir, ticketId.toString(), filename);

    if (!filePath.startsWith(path.resolve(uploadDir))) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found on disk' } });
    }

    res.sendFile(filePath);
  }

  async delete(req, res) {
    const { ticketId, attachmentId } = req.params;
    const userId = req.user.userId;

    await TicketAttachmentService.delete(attachmentId, ticketId, userId);
    res.json({ success: true, message: 'Attachment deleted successfully' });
  }
}

module.exports = new TicketAttachmentController();
