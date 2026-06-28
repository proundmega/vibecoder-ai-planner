const { pool } = require('../db');
const { ValidationError, NotFoundError } = require('../errors/HttpError');

class MilestoneService {
  static async list(projectId) {
    const result = await pool.query(
      'SELECT * FROM milestones WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  static async create(projectId, { name, description, targetDate }) {
    if (!name || name.trim().length === 0) {
      throw new ValidationError('Milestone name is required');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE milestones SET is_active=false WHERE project_id=$1 AND is_active=true',
        [projectId]
      );
      const result = await client.query(
        'INSERT INTO milestones (project_id, name, description, target_date) VALUES ($1, $2, $3, $4) RETURNING *',
        [projectId, name.trim(), description || null, targetDate || null]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async update(id, { name, description, targetDate }) {
    const sets = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(name.trim());
    }
    if (description !== undefined) {
      sets.push(`description=$${idx++}`);
      vals.push(description);
    }
    if (targetDate !== undefined) {
      sets.push(`target_date=$${idx++}`);
      vals.push(targetDate);
    }

    if (sets.length === 0) {
      throw new ValidationError('No fields to update');
    }

    vals.push(id);
    const result = await pool.query(
      `UPDATE milestones SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`,
      vals
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Milestone not found');
    }

    return result.rows[0];
  }

  static async getProgress(id) {
    const result = await pool.query(
      `SELECT
        COALESCE(SUM(estimate), 0) AS total_estimate,
        COALESCE(SUM(estimate) FILTER (WHERE phase = 'done' OR status = 'done'), 0) AS completed_estimate
      FROM tickets WHERE milestone_id = $1`,
      [id]
    );

    const { total_estimate, completed_estimate } = result.rows[0];
    const percentage = Number(total_estimate) > 0
      ? Math.round((Number(completed_estimate) / Number(total_estimate)) * 100)
      : 0;

    return {
      totalEstimate: Number(total_estimate),
      completedEstimate: Number(completed_estimate),
      percentage,
    };
  }

  static async getTickets(id) {
    const result = await pool.query(
      'SELECT * FROM tickets WHERE milestone_id = $1 ORDER BY created_at',
      [id]
    );
    return result.rows;
  }
}

module.exports = MilestoneService;
