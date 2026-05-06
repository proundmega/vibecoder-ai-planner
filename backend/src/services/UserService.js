const User = require('../models/user');
const authService = require('../auth');

class UserService {
  static async authenticate(email, password) {
    const user = await User.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new Error('Invalid credentials');
    }
    return user;
  }

  static async register(name, email, password) {
    const exists = await User.existsByEmail(email);
    if (exists) throw new Error('Email already registered');

    return await User.create(name, email, password);
  }

  static async findById(id) {
    return await User.find(id);
  }

  static async createSession(user, token) {
    const session = await User.findByEmail(user.email);
    return {
      token,
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        role: session.role,
      },
    };
  }

  static async updateRole(id, role) {
    await User.constructor.updateRole(id, role);
  }

  static async upgradeSubscription(id, tierId) {
    const user = await User.findById(id);
    await User.constructor.createPlan(id, tierId);
    return user;
  }
}

module.exports = new UserService();
