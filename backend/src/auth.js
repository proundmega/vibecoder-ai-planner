const jwt = require('jsonwebtoken');
const UserService = require('./services/UserService');
const TOKEN_EXPIRY_HOURS = parseInt(process.env.TOKEN_EXPIRY_HOURS) || 24;
const TOKEN_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production';

class AuthService {
  async register(name, email, password) {
    const user = await UserService.register(name, email, password);
    
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      TOKEN_SECRET,
      { expiresIn: TOKEN_EXPIRY_HOURS }
    );
    
    return this.createSession(user, token);
  }

  async login(email, password) {
    const user = await UserService.authenticate(email, password);
    
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      TOKEN_SECRET,
      { expiresIn: TOKEN_EXPIRY_HOURS }
    );
    
    return this.createSession(user, token);
  }

  async verifyToken(token) {
    try {
      return jwt.verify(token, TOKEN_SECRET);
    } catch {
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
      }
    };
  }
}

module.exports = new AuthService();
