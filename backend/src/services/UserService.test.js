const UserService = require('./UserService');

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create new user', async () => {
      const user = await UserService.register('Test User', 'test@example.com', 'password123');
      expect(user).toBeDefined();
      expect(user.email).toBe('test@example.com');
    });

    it('should hash password', async () => {
      const user = await UserService.register('User', 'test@test.com', 'pass');
      expect(user.passwordHash).toBeDefined();
    });

    it('should set default role to user', async () => {
      const user = await UserService.register('User', 'test@test.com', 'pass');
      expect(user.role).toBe('user');
    });

    it('should set default plan to free', async () => {
      const user = await UserService.register('User', 'test@test.com', 'pass');
      expect(user.currentPlan).toBe('free');
    });
  });

  describe('authenticate', () => {
    it('should find user by email', async () => {
      const user = await UserService.authenticate('test@test.com', 'password');
      expect(user).toBeDefined();
    });

    it('should return null for non-existent email', async () => {
      const user = await UserService.authenticate('noexist@test.com', 'password');
      expect(user).toBeNull();
    });
  });

  describe('updateRole', () => {
    it('should update user role', async () => {
      await UserService.updateRole('user-1', 'admin');
    });
  });

  describe('upgradePlan', () => {
    it('should upgrade user plan', async () => {
      await UserService.upgradePlan('user-1', 'premium');
    });
  });

  describe('createSubscription', () => {
    it('should create subscription entry', async () => {
      await UserService.createSubscription('user-1', 'tier-1', 9.99);
    });
  });
});
