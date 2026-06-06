const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/user');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

class UserService {
  async register(name, email, password, role = 'user', userCreatedBy = null) {
    const exists = await User.existsByEmail(email);
    if (exists) {
      throw new Error('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, user_created_by, current_plan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email, hashedPassword, role, userCreatedBy, 'free']
    );
    return new User(result.rows[0]);
  }

  async authenticate(email, password) {
    const user = await User.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (!user.isActive) {
      throw new Error('Account deactivated. Contact support.');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';
    const TOKEN_EXPIRY_HOURS = parseInt(process.env.TOKEN_EXPIRY_HOURS) || 24;
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY_HOURS }
    );
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.currentPlan,
      isActive: user.isActive,
      token
    };
  }

  async getCurrentUser(token) {
    const JWT_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';
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

  async listUsers(userId, userRole, filters = {}) {
    const { role, search, page = 1, perPage = 20 } = filters;
    const offset = (page - 1) * perPage;
    
    let whereClause = '1=1';
    const params = [];
    
    if (userRole === 'project_admin') {
      whereClause += ' AND (user_created_by = $1 OR id = $2)';
      params.push(userId, userId);
    } else if (userRole === 'member') {
      whereClause += ' AND user_created_by = $1';
      params.push(userId);
    }
    
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

  async listAllUsers(filters = {}) {
    const { role, search, is_active, page = 1, perPage = 50 } = filters;
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
    
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      whereClause += ` AND is_active = $${params.length}`;
    }
    
    const result = await pool.query(
      `SELECT * FROM users WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, perPage, offset]
    );
    
    return result.rows.map(row => new User(row));
  }

  async createUser(name, email, password, role, createdBy) {
    const exists = await User.existsByEmail(email);
    if (exists) {
      throw new Error('Email already registered');
    }

    if (role === 'super_admin') {
      throw new Error('Super admin accounts must be created manually');
    }

    if (createdBy) {
      const creator = await User.find(createdBy);
      if (creator) {
        if (creator.role === 'project_admin') {
          if (!['member', 'user'].includes(role)) {
            throw new Error('Project admins can only create member or user accounts');
          }
        } else if (creator.role === 'member') {
          if (role !== 'user') {
            throw new Error('Members can only create user accounts');
          }
        } else if (creator.role === 'user') {
          throw new Error('AI agents cannot create user accounts');
        }
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, user_created_by, current_plan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, email, hashedPassword, role, createdBy, 'free']
    );
    return new User(result.rows[0]);
  }

  async updateUser(userId, adminId, updates) {
    const admin = await User.find(adminId);
    const targetUser = await User.find(userId);
    
    if (!targetUser) {
      throw new Error('User not found');
    }
    
    if (userId === adminId) {
      throw new Error('Cannot update your own account');
    }
    
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

  async toggleUserActive(userId, adminId) {
    const admin = await User.find(adminId);
    const targetUser = await User.find(userId);
    
    if (!targetUser) {
      throw new Error('User not found');
    }
    
    if (userId === adminId) {
      throw new Error('Cannot toggle your own account');
    }
    
    const result = await pool.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [userId]
    );
    
    return result.rows.length > 0 ? new User(result.rows[0]) : null;
  }

  async deleteUser(userId, adminId) {
    const admin = await User.find(adminId);
    const targetUser = await User.find(userId);
    
    if (!targetUser) {
      throw new Error('User not found');
    }
    
    if (userId === adminId) {
      throw new Error('Cannot delete your own account');
    }
    
    await User.delete(userId);
  }
}

module.exports = new UserService();
