const { pool, transaction } = require('../db');

class Project {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description;
    this.ownerId = data.ownerId;
    this.createdAt = data.createdAt;
  }

  static async create(name, description, ownerId) {
    const result = await pool.query(
      `INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3)
       RETURNING *`,
      [name, description, ownerId]
    );
    return new Project(result.rows[0]);
  }

  static async findAll(uid) {
    const result = await pool.query(
      'SELECT p.*, u.name as owner_name FROM projects p ' +
      'JOIN users u ON p.owner_id = u.id WHERE p.owner_id = $1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC',
      [uid]
    );
    return result.rows.map(r => this.fromRow(r));
  }

  static async findById(id) {
    const result = await pool.query(
      'SELECT p.*, u.name as owner_name FROM projects p ' +
      'JOIN users u ON p.owner_id = u.id WHERE p.id = $1 AND p.deleted_at IS NULL',
      [id]
    );
    return result.rows.length > 0 ? this.fromRow(result.rows[0]) : null;
  }

  static fromRow(row) {
    return new Project({
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      createdAt: row.created_at,
    });
  }

  static async update(id, name, description) {
    const result = await pool.query(
      'UPDATE projects SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, description, id]
    );
    return this.fromRow(result.rows[0]);
  }

  static async delete(id) {
    await pool.query(
      'UPDATE projects SET deleted_at = NOW() WHERE id = $1',
      [id]
    );
  }

  static async deleteWithAudit(id, userId, action) {
    return transaction(async (client) => {
      const project = await this.findById(id);
      if (!project) {
        throw new Error('Project not found');
      }

      await client.query(
        'UPDATE projects SET deleted_at = NOW() WHERE id = $1',
        [id]
      );

      await client.query(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [userId, action, 'project', id]
      );
    });
  }

  static async share(id, userId) {
    return transaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
        [id, userId]
      );

      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1, $2, \'member\')',
          [id, userId]
        );
      }
    });
  }
}

module.exports = Project;
