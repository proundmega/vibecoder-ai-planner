const { pool } = require('../db');

ApprovalRequest.pool = pool;

class ApprovalRequest {
  static async create(ticketId, requestedBy) {
    const result = await pool.query(
      `INSERT INTO approval_requests (ticket_id, requested_by, status) 
       VALUES ($1, $2, 'pending') RETURNING *`,
      [ticketId, requestedBy]
    );
    return result.rows[0];
  }

  static async findByTicket(ticketId) {
    const result = await pool.query(
      `SELECT * FROM approval_requests 
       WHERE ticket_id = $1 AND status = 'pending' 
       ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    );
    return result.rows[0] || null;
  }

  static async approve(approvalId, approvedBy) {
    const result = await pool.query(
      `UPDATE approval_requests 
       SET status = 'approved', approved_by = $2, approved_at = NOW() 
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [approvalId, approvedBy]
    );
    return result.rows[0] || null;
  }

  static async reject(approvalId, approvedBy) {
    const result = await pool.query(
      `UPDATE approval_requests 
       SET status = 'rejected', approved_by = $2, approved_at = NOW() 
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [approvalId, approvedBy]
    );
    return result.rows[0] || null;
  }

  static async listByUser(userId) {
    const result = await pool.query(
      `SELECT ar.*, t.title as ticket_title, u.name as requester_name
       FROM approval_requests ar
       JOIN tickets t ON ar.ticket_id = t.id
       JOIN users u ON ar.requested_by = u.id
       WHERE ar.approved_by = $1 AND ar.status = 'pending'
       ORDER BY ar.created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async getByTicketAndRequester(ticketId, requestedBy) {
    const result = await pool.query(
      `SELECT * FROM approval_requests 
       WHERE ticket_id = $1 AND requested_by = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [ticketId, requestedBy]
    );
    return result.rows[0] || null;
  }

  static async getPendingByRequester(requestedBy) {
    const result = await pool.query(
      `SELECT ar.*, t.title as ticket_title, t.status as ticket_status
       FROM approval_requests ar
       JOIN tickets t ON ar.ticket_id = t.id
       WHERE ar.requested_by = $1 AND ar.status = 'pending'
       ORDER BY ar.created_at DESC`,
      [requestedBy]
    );
    return result.rows;
  }

  static async getByTicketId(ticketId) {
    const result = await pool.query(
      `SELECT ar.*, u.name as requester_name, u.email as requester_email
       FROM approval_requests ar
       JOIN users u ON ar.requested_by = u.id
       WHERE ar.ticket_id = $1
       ORDER BY ar.created_at DESC`,
      [ticketId]
    );
    return result.rows;
  }
}

module.exports = ApprovalRequest;
