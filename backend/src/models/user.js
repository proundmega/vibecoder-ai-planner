const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const pool = require('../db');

class User {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.email = data.email;
    this.name = data.name;
    this.passwordHash = data.passwordHash;
    this.role = data.role || 'user';
    this.currentPlan = data.currentPlan || 'free';
    this.createdAt = data.createdAt;
  }

  static async create(name, email, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, current_plan) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, hashedPassword, 'free']
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

  static async updateRole(id, role) {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
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

  static async register(name, email, password) {
    const exists = await User.existsByEmail(email);
    if (exists) {
      throw new Error('Email already registered');
    }

    const user = await User.create(name, email, password);
    return user;
  }
}

module.exports = User;
