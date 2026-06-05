const bcrypt = require('bcryptjs');
const { pool } = require('../db');

class User {
  constructor(data) {
    this.id = data.id;
    this.email = data.email;
    this.name = data.name;
    this.passwordHash = data.password_hash;
    this.role = data.role || 'project_admin';
    this.currentPlan = data.current_plan || 'free';
    this.isActive = data.is_active !== false;
    this.userCreatedBy = data.user_created_by || null;
    this.createdAt = data.created_at;
  }

  static async create(name, email, password, role = 'project_admin', userCreatedBy = null) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, user_created_by, current_plan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email, hashedPassword, role, userCreatedBy, 'free']
    );
    return new User(result.rows[0]);
  }

  static async find(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return new User(result.rows[0]);
  }

  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return null;
    return new User(result.rows[0]);
  }

  static async existsByEmail(email) {
    const result = await pool.query('SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)', [email]);
    return result.rows[0].exists;
  }

  static async findAll(filters = {}) {
    const { role, search, page = 1, perPage = 20 } = filters;
    const offset = (page - 1) * perPage;
    
    let whereClause = '1=1';
    const params = [];
    
    if (role) {
      params.push(role);
      whereClause += ` AND role = $${params.length}`;
    }
    
    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    
    const result = await pool.query(
      `SELECT * FROM users WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, perPage, offset]
    );
    
    return result.rows.map(row => new User(row));
  }

  static async update(userId, updates) {
    const { name, is_active } = updates;
    const sets = [];
    const params = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    
    if (is_active !== undefined) {
      sets.push(`is_active = $${paramIndex++}`);
      params.push(is_active);
    }
    
    if (sets.length === 0) return null;
    
    sets.push(`updated_at = NOW()`);
    params.push(userId);
    
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    
    return result.rows.length > 0 ? new User(result.rows[0]) : null;
  }

  static async toggleActive(userId) {
    const result = await pool.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [userId]
    );
    return result.rows.length > 0 ? new User(result.rows[0]) : null;
  }

  static async delete(id) {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  static async findByRole(role) {
    const result = await pool.query('SELECT * FROM users WHERE role = $1', [role]);
    return result.rows.map(row => new User(row));
  }

  static async upgradePlan(id, plan) {
    await pool.query('UPDATE users SET current_plan = $1 WHERE id = $2', [plan, id]);
  }

  static async createSubscription(userId, tierId, price) {
    await pool.query(
      `INSERT INTO user_pricing_tiers (user_id, pricing_tier_id, started_at, ended_at)
       VALUES ($1, $2, NOW(), NULL)
       ON CONFLICT (user_id) DO UPDATE SET pricing_tier_id = $2`,
      [userId, tierId, price]
    );
  }
}

module.exports = User;
