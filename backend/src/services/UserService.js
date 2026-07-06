const bcrypt = require('bcryptjs');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const { ValidationError, NotFoundError } = require('../errors/HttpError');
const { getSecret } = require('../utils/jwt');
const logger = require('../utils/logger');

class UserService {
  async register(name, email, password, role = 'project_admin', userCreatedBy = null) {
    const exists = await User.existsByEmail(email);
    if (exists) {
      throw new ValidationError('Email already registered');
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
      throw new ValidationError('Invalid credentials');
    }

    if (!user.isActive) {
      throw new ValidationError('Account deactivated. Contact support.');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new ValidationError('Invalid credentials');
    }

    return user;
  }

  async getCurrentUser(token) {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, getSecret());
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
    
    const canViewAll = await PermissionService.hasPermission(userRole, 'USER_VIEW_ALL');
    if (!canViewAll) {
      if (userRole === 'project_admin') {
        whereClause += ' AND (user_created_by = $1 OR id = $2)';
        params.push(userId, userId);
      } else if (userRole === 'member') {
        whereClause += ' AND user_created_by = $1';
        params.push(userId);
      }
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
      throw new ValidationError('Email already registered');
    }

    if (role === 'super_admin') {
      throw new ValidationError('Super admin accounts must be created manually');
    }

    if (createdBy) {
      const creator = await User.find(createdBy);
      if (creator) {
        const canCreate = await PermissionService.hasPermission(creator.role, 'USER_CREATE');
        if (!canCreate) {
          throw new ValidationError('Insufficient permissions to create users');
        }
        // Role hierarchy still enforced: project_admin can create member+user, member can create user only
        if (creator.role === 'project_admin') {
          if (!['member', 'user'].includes(role)) {
            throw new ValidationError('Project admins can only create member or user accounts');
          }
        } else if (creator.role === 'member') {
          if (role !== 'user') {
            throw new ValidationError('Members can only create user accounts');
          }
        } else if (creator.role === 'user') {
          throw new ValidationError('AI agents cannot create user accounts');
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
      throw new NotFoundError('User not found');
    }
    
    if (userId === adminId) {
      throw new ValidationError('Cannot update your own account');
    }
    
    const { name, is_active, role } = updates;
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
    
    const oldRole = targetUser.role;
    if (role !== undefined && role !== oldRole) {
      sets.push(`role = $${paramIndex++}`);
      params.push(role);
    }
    
    if (sets.length === 0) return null;
    
    sets.push(`updated_at = NOW()`);
    params.push(userId);
    
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    
    const updatedUser = result.rows.length > 0 ? new User(result.rows[0]) : null;
    
    // Invalidate permission caches when role changes
    if (updatedUser && role && role !== oldRole) {
      try {
        await PermissionService.invalidateRoleCache(oldRole);
        await PermissionService.invalidateRoleCache(role);
      } catch (err) {
        logger.warn(`Failed to invalidate permission cache for role change: ${err.message}`);
      }
    }
    
    return updatedUser;
  }

  async toggleUserActive(userId, adminId) {
    const admin = await User.find(adminId);
    const targetUser = await User.find(userId);
    
    if (!targetUser) {
      throw new NotFoundError('User not found');
    }
    
    if (userId === adminId) {
      throw new ValidationError('Cannot toggle your own account');
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
      throw new NotFoundError('User not found');
    }
    
    if (userId === adminId) {
      throw new ValidationError('Cannot delete your own account');
    }
    
    await User.delete(userId);
  }
}

module.exports = new UserService();
