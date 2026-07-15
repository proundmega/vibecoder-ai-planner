const { pool } = require('../db');
const path = require('path');
const { AppError } = require('../errors/HttpError');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/tickets');

class TicketAttachmentService {
  async upload(ticketId, file, userId) {
    let ticketResult;
    try {
      ticketResult = await pool.query('SELECT id FROM tickets WHERE id = $1', [ticketId]);
    } catch (err) {
      if (err.code === '22P02' || err.message.includes('invalid input syntax')) {
        throw new AppError('Ticket not found', 404, 'NOT_FOUND');
      }
      throw err;
    }
    if (ticketResult.rows.length === 0) {
      throw new AppError('Ticket not found', 404, 'NOT_FOUND');
    }
    const storedPath = file.path;
    const result = await pool.query(
      `INSERT INTO ticket_attachments (ticket_id, filename, content_type, size_bytes, stored_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [ticketId, file.originalname, file.mimetype, file.size, storedPath, userId]
    );
    return result.rows[0];
  }

  async list(ticketId, _userId) {
    const result = await pool.query(
      `SELECT ta.*, u.name as uploaded_by_name
       FROM ticket_attachments ta
       LEFT JOIN users u ON ta.uploaded_by = u.id
       WHERE ta.ticket_id = $1
       ORDER BY ta.created_at DESC`,
      [ticketId]
    );
    return result.rows;
  }

  async get(attachmentId, ticketId, _userId) {
    const result = await pool.query(
      `SELECT ta.*, u.name as uploaded_by_name, t.title as ticket_title
       FROM ticket_attachments ta
       LEFT JOIN users u ON ta.uploaded_by = u.id
       JOIN tickets t ON ta.ticket_id = t.id
       WHERE ta.id = $1 AND ta.ticket_id = $2`,
      [attachmentId, ticketId]
    );
    return result.rows[0] || null;
  }

  async delete(attachmentId, ticketId, userId) {
    const attachment = await this.get(attachmentId, ticketId, userId);
    if (!attachment) {
      throw new Error('Attachment not found');
    }

    const filePath = path.join(uploadDir, ticketId.toString(), path.basename(attachment.stored_path));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await pool.query(
      'DELETE FROM ticket_attachments WHERE id = $1 AND ticket_id = $2',
      [attachmentId, ticketId]
    );

    return true;
  }
}

module.exports = new TicketAttachmentService();
