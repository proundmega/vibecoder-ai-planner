/**
 * UserService Tests
 * TKT: Testing User Service methods
 */

const UserService = require('./UserService');

describe('UserService', () => {
  describe('register', () => {
    it('should create new user', async () => {
      const user = await UserService.register('Test User', 'test@example.com', 'password123');
      expect(user).toBeDefined();
    });

    it('should set default role to user', async () => {
      const user = await UserService.register('User', 'test@test.com', 'pass');
      expect(user.role).toBe('user');
    });
  });
});
