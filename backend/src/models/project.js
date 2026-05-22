const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');

class Project {
  constructor(data) {
    this.id = data.id || uuidv4();
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
      'JOIN users u ON p.owner_id = u.id WHERE p.owner_id = $1 ORDER BY p.created_at DESC',
      [uid]
    );
    return result.rows.map(r => this.fromRow(r));
  }

  static async findById(id) {
    const result = await pool.query(
      'SELECT p.*, u.name as owner_name FROM projects p ' +
      'JOIN users u ON p.owner_id = u.id WHERE p.id = $1',
      [id]
    );
    return result.rows.length > 0 ? this.fromRow(result.rows[0]) : null;
  }

  static async fromRow(row) {
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
    await pool.query(
      'UPDATE projects SET name = $1, description = $2, updated_at = NOW() WHERE id = $3',
      [name, description, id]
    );
  }

  static async delete(id) {
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
  }

  static async share(id, userId) {
    // Create a project membership
    await pool.query(
      'INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1, $2, \'member\')',
      [id, userId]
    );
  }
}

module.exports = Project;
