const { pool, transaction } = require('../db');
const { ValidationError } = require('../errors/HttpError');

const VALID_TRANSITIONS = {
  backlog: ['in_progress'],
  in_progress: ['review', 'backlog'],
  review: ['done', 'backlog'],
  done: [],
};

class Ticket {
  constructor(data) {
    this.id = data.id;
    this.projectId = data.projectId;
    this.title = data.title;
    this.description = data.description;
    this.status = data.status || 'backlog';
    this.priority = data.priority || 'medium';
    this.assigneeId = data.assigneeId;
    this.ownerId = data.ownerId;
    this.planningStatus = data.planning_status || 'not_started';
    this.templateSchema = data.template_schema || null;
    this.phase = data.phase || 'draft';
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async create(projectId, title, description, priority, ownerId) {
    const result = await pool.query(
      `INSERT INTO tickets 
       (project_id, title, description, status, priority, owner_id, phase) 
       VALUES ($1, $2, $3, 'backlog', $4, $5, 'draft')
       RETURNING *`,
      [projectId, title, description, priority || 'medium', ownerId]
    );
    return new Ticket(result.rows[0]);
  }

  static async findByProject(projectId, uid) {
    const result = await pool.query(
      'SELECT t.*, u.name as assignee_name, p.name as project_name ' +
      'FROM tickets t ' +
      'LEFT JOIN users u ON t.assignee_id = u.id ' +
      'JOIN projects p ON t.project_id = p.id ' +
      'WHERE t.project_id = $1 AND t.deleted_at IS NULL ORDER BY t.created_at DESC',
      [projectId]
    );
    return result.rows.map(r => this.fromRow(r));
  }

  static async findByStatus(projectId, status) {
    const result = await pool.query(
      'SELECT * FROM tickets WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL ORDER BY created_at',
      [projectId, status]
    );
    return result.rows.map(r => this.fromRow(r));
  }

  static async findById(id) {
    const result = await pool.query(
      'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL', [id]);
    return result.rows.length > 0 ? this.fromRow(result.rows[0]) : null;
  }

  static fromRow(row) {
    return new Ticket({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assignee_id,
      assigneeName: row.assignee_name,
      ownerId: row.owner_id,
      projectName: row.project_name,
      planning_status: row.planning_status,
      template_schema: row.template_schema,
      phase: row.phase,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  static async update(id, title, description, status, priority, assigneeId, userId) {
    // Fetch current ticket to validate transitions
    const current = await Ticket.findById(id);
    if (current && status) {
      const allowed = VALID_TRANSITIONS[current.status] || [];
      if (!allowed.includes(status)) {
      throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
      }
    }

    const query = `UPDATE tickets SET 
      title = COALESCE($1, title),
      description = COALESCE($2, description),
      status = COALESCE($3, status),
      priority = COALESCE($4, priority),
      assignee_id = COALESCE($5, assignee_id),
      updated_at = NOW()
    WHERE id = $6`;

    await pool.query(query, [
      title, description, status, priority, assigneeId, id
    ]);
  }

  static async delete(id) {
    await pool.query(
      'UPDATE tickets SET deleted_at = NOW(), status = \'done\' WHERE id = $1',
      [id]
    );
  }

  static async deleteWithAudit(id, userId, action) {
    return transaction(async (client) => {
      const current = await this.findById(id);
      if (!current) {
        throw new Error('Ticket not found');
      }

      await client.query(
        'UPDATE tickets SET deleted_at = NOW(), status = \'done\' WHERE id = $1',
        [id]
      );

      await client.query(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [userId, action, 'ticket', id]
      );
    });
  }

  static async updateStatus(id, status, userId) {
    const current = await Ticket.findById(id);
    if (!current) throw new Error('Ticket not found');

    const allowed = VALID_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
    }

    await pool.query(
      'UPDATE tickets SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );
  }

  static async getComments(ticketId) {
    const result = await pool.query(
      `SELECT tc.*, u.name as user_email
       FROM ticket_comments tc
       LEFT JOIN users u ON tc.user_id = u.id
       WHERE tc.ticket_id = $1
       ORDER BY tc.created_at ASC`,
      [ticketId]
    );
    return result.rows;
  }

  static async addComment(ticketId, content, userId) {
    const result = await pool.query(
      `INSERT INTO ticket_comments (ticket_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [ticketId, userId, content]
    );
    return result.rows[0];
  }
}

module.exports = Ticket;
