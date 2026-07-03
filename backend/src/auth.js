const jwt = require('jsonwebtoken');
const UserService = require('./services/UserService');
const User = require('./models/user');
const TOKEN_EXPIRY_MINUTES = parseInt(process.env.TOKEN_EXPIRY_MINUTES) || 30;
const TOKEN_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';
const logger = require('./utils/logger');

class AuthService {
  async register(name, email, password, role = 'project_admin', userCreatedBy = null) {
    if (role === 'super_admin') {
      throw new Error('Super admin accounts must be created manually');
    }
    
    if (userCreatedBy) {
      const creator = await User.find(userCreatedBy);
      if (!creator) {
        throw new Error('Creator not found');
      }
      
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
    
    const user = await UserService.register(name, email, password, role, userCreatedBy);
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      TOKEN_SECRET,
      { expiresIn: `${TOKEN_EXPIRY_MINUTES}m` }
    );
    
    return this.createSession(user, token);
  }

  async login(email, password) {
    const user = await UserService.authenticate(email, password);
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      TOKEN_SECRET,
      { expiresIn: `${TOKEN_EXPIRY_MINUTES}m` }
    );
    
    return this.createSession(user, token);
  }

  async verifyToken(token) {
    try {
      return jwt.verify(token, TOKEN_SECRET);
    } catch (error) {
      logger.error('verifyToken:', error);
      return null;
    }
  }

  createSession(user, token) {
    return {
      token,
      user: {
        id: user.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.currentPlan,
        isActive: user.isActive,
      }
    };
  }
}

module.exports = new AuthService();
