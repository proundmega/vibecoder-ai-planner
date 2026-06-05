const jwt = require('jsonwebtoken');
const UserService = require('./services/UserService');
const TOKEN_EXPIRY_MINUTES = parseInt(process.env.TOKEN_EXPIRY_MINUTES) || 30;
const TOKEN_SECRET = process.env.JWT_SECRET || 'vibecode-dev-secret-do-not-use-in-production';

class AuthService {
  async register(name, email, password, role = 'project_admin', userCreatedBy = null) {
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
      console.error('verifyToken:', error);
      return null;
    }
  }

  createSession(user, token) {
    return {
      token,
      user: {
        id: user.id,
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
