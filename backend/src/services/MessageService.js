const { pool } = require('../db');

class MessageService {
  static async postMessage(ticketId, userId, messageType, content, metadata = {}) {
    const result = await pool.query(
      `INSERT INTO ticket_messages (ticket_id, user_id, message_type, content, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ticketId, userId, messageType, content, JSON.stringify(metadata)]
    );

    return this._withUserInfo(result.rows[0]);
  }

  static async getTicketMessages(ticketId, limit = 50) {
    const result = await pool.query(
      `SELECT tm.*, u.name as user_name, u.email as user_email
       FROM ticket_messages tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.ticket_id = $1
       ORDER BY tm.created_at ASC
       LIMIT $2`,
      [ticketId, limit]
    );

    return result.rows.map(row => this._withUserInfo(row));
  }

  static async getUnreadMessages(userId, since) {
    const result = await pool.query(
      `SELECT tm.*, u.name as user_name, u.email as user_email
       FROM ticket_messages tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.created_at > $1
       AND tm.user_id != $2
       ORDER BY tm.created_at ASC`,
      [since, userId]
    );

    return result.rows.map(row => this._withUserInfo(row));
  }

  static _withUserInfo(row) {
    let metadata = row.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        metadata = {};
      }
    }

    return {
      id: row.id,
      ticketId: row.ticket_id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      messageType: row.message_type,
      content: row.content,
      metadata,
      createdAt: row.created_at,
    };
  }
}

module.exports = MessageService;
