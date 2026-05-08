const bcrypt = require('bcryptjs');
const User = require('../models/user');
const authService = require('../auth');
const pool = require('../db').pool;

class UserService {
  static async register(name, email, password) {
    const exists = await User.existsByEmail(email);
    if (exists) {
      throw new Error('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, current_plan) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, hashedPassword, 'free']
    );
    return new User(result.rows[0]);
  }

  static async authenticate(email, password) {
    const user = await User.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const token = await authService.generateToken(user.id, email);
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.currentPlan,
      token
    };
  }

  static async getCurrentUser(token) {
    const decoded = require('../auth').verifyToken(token);
    const user = await User.find(decoded.userId);
    return user;
  }

  static async updateProfile(userId, updates) {
    const { name, ...rest } = updates;
    
    const result = await pool.query(
      `UPDATE users 
       SET name = COALESCE($1, name)
       WHERE id = $2
       RETURNING *`,
      [name, userId]
    );

    return result.rows[0];
  }
}

module.exports = new UserService();
