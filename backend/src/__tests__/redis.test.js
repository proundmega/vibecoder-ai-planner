const redis = require('../utils/redis');

describe('Redis utility module', () => {
  describe('getPrefixedKey', () => {
    it('should prefix keys with vibecode:', () => {
      expect(redis.getPrefixedKey('test')).toBe('vibecode:test');
    });

    it('should handle keys with colons', () => {
      expect(redis.getPrefixedKey('ratelimit:127.0.0.1')).toBe('vibecode:ratelimit:127.0.0.1');
    });
  });

  describe('isRedisAvailable', () => {
    it('should return a boolean', () => {
      const result = redis.isRedisAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('healthCheck', () => {
    it('should return a health status object', async () => {
      const result = await redis.healthCheck();
      expect(result).toHaveProperty('status');
    });
  });

  describe('closeRedis', () => {
    it('should be a function', () => {
      expect(typeof redis.closeRedis).toBe('function');
    });

    it('should resolve without error', async () => {
      await expect(redis.closeRedis()).resolves.toBeUndefined();
    });
  });

  describe('connection functions', () => {
    it('should have connectRedis function', () => {
      expect(typeof redis.connectRedis).toBe('function');
    });

    it('should have ensureConnected function', () => {
      expect(typeof redis.ensureConnected).toBe('function');
    });
  });
});
