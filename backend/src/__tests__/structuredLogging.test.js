const logger = require('../utils/logger');

describe('BP-07: Structured Logging', () => {
  describe('maskSensitive', () => {
    it('should mask password field', () => {
      const input = { username: 'test', password: 'secret123' };
      const result = logger.maskSensitive(input);
      expect(result.password).toBe('sec***');
      expect(result.username).toBe('test');
    });

    it('should mask token field', () => {
      const input = { userId: 1, token: 'my-secret-token' };
      const result = logger.maskSensitive(input);
      expect(result.token).toBe('my-***');
      expect(result.userId).toBe(1);
    });

    it('should mask apiKey field', () => {
      const input = { service: 'api', apiKey: 'sk-1234567890' };
      const result = logger.maskSensitive(input);
      expect(result.apiKey).toBe('sk-***');
      expect(result.service).toBe('api');
    });

    it('should mask authorization header', () => {
      const input = { method: 'GET', authorization: 'Bearer my-token' };
      const result = logger.maskSensitive(input);
      expect(result.authorization).toBe('Bea***');
      expect(result.method).toBe('GET');
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: 'test',
          credentials: {
            password: 'secret',
            apiKey: 'sk-123'
          }
        }
      };
      const result = logger.maskSensitive(input);
      expect(result.user.credentials.password).toBe('sec***');
      expect(result.user.credentials.apiKey).toBe('sk-***');
      expect(result.user.name).toBe('test');
    });

    it('should handle arrays', () => {
      const input = {
        users: [
          { name: 'user1', password: 'pass1' },
          { name: 'user2', password: 'pass2' }
        ]
      };
      const result = logger.maskSensitive(input);
      expect(result.users[0].password).toBe('pas***');
      expect(result.users[1].password).toBe('pas***');
      expect(result.users[0].name).toBe('user1');
    });

    it('should not mask non-sensitive fields', () => {
      const input = { name: 'test', email: 'test@example.com', age: 30 };
      const result = logger.maskSensitive(input);
      expect(result.name).toBe('test');
      expect(result.email).toBe('test@example.com');
      expect(result.age).toBe(30);
    });

    it('should handle short strings', () => {
      const input = { password: 'ab' };
      const result = logger.maskSensitive(input);
      expect(result.password).toBe('***');
    });

    it('should return null and undefined as-is', () => {
      expect(logger.maskSensitive(null)).toBeNull();
      expect(logger.maskSensitive(undefined)).toBeUndefined();
    });

    it('should handle primitive values', () => {
      expect(logger.maskSensitive('test')).toBe('test');
      expect(logger.maskSensitive(123)).toBe(123);
      expect(logger.maskSensitive(true)).toBe(true);
    });

    it('should not mask non-sensitive field values', () => {
      const input = { note: 'This contains password info' };
      const result = logger.maskSensitive(input);
      expect(result.note).toBe('This contains password info');
    });
  });

  describe('logger exports', () => {
    it('should export maskSensitive function', () => {
      expect(typeof logger.maskSensitive).toBe('function');
    });

    it('should export winston logger methods', () => {
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });
  });
});
