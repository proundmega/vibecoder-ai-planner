const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/user');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

class UserService {
  async register(name, email, password) {
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

  async authenticate(email, password) {
    const user = await User.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    const TOKEN_EXPIRY_HOURS = parseInt(process.env.TOKEN_EXPIRY_HOURS) || 24;
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY_HOURS }
    );
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.currentPlan,
      token
    };
  }

  async getCurrentUser(token) {
    const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.find(decoded.userId);
    return user;
  }

  async updateProfile(userId, updates) {
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
