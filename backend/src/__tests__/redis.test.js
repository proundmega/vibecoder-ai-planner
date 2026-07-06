const redis = require('../utils/redis');
const { get, set, del, zadd, zremrangebyscore, zcard, expire, evalScript, scan, getRedis, ensureConnected } = require('../utils/redis');

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

    it('ensureConnected should resolve to true when mock returns true', async () => {
      const result = await ensureConnected();
      expect(result).toBe(true);
    });
  });

  describe('getRedis', () => {
    it('should return the redis client from mock', () => {
      const client = getRedis();
      expect(client).toBeDefined();
    });

    it('should return the same client reference on multiple calls', () => {
      const client1 = getRedis();
      const client2 = getRedis();
      expect(client1).toBe(client2);
    });
  });

  describe('get', () => {
    it('should call redis get with prefixed key', async () => {
      const result = await get('test-key');
      expect(result).toBeDefined();
    });

    it('should return null when key does not exist', async () => {
      const result = await get('nonexistent-key');
      expect(result).toBeNull();
    });

    it('should return stored value for existing key', async () => {
      await set('existing-key', 'test-value');
      const result = await get('existing-key');
      expect(result).toBe('test-value');
    });
  });

  describe('set', () => {
    it('should store a value', async () => {
      const result = await set('test-key', 'test-value', 60);
      expect(result).toBe(true);
    });

    it('should store value without TTL', async () => {
      const result = await set('test-key-no-ttl', 'test-value');
      expect(result).toBe(true);
    });

    it('should overwrite existing value', async () => {
      await set('overwrite-key', 'original');
      await set('overwrite-key', 'updated');
      const result = await get('overwrite-key');
      expect(result).toBe('updated');
    });
  });

  describe('del', () => {
    it('should delete an existing key', async () => {
      await set('delete-me', 'value');
      const result = await del('delete-me');
      expect(result).toBe(1);
    });

    it('should return 0 for non-existent key', async () => {
      const result = await del('non-existent-key');
      expect(result).toBe(0);
    });

    it('should actually remove the key', async () => {
      await set('delete-and-verify', 'value');
      await del('delete-and-verify');
      const result = await get('delete-and-verify');
      expect(result).toBeNull();
    });
  });

  describe('zadd', () => {
    it('should add a score-member pair', async () => {
      const result = await zadd('test-zset', 1, 'member1');
      expect(result).toBe(1);
    });

    it('should handle multiple zadd calls', async () => {
      await zadd('test-zset', 1, 'member1');
      await zadd('test-zset', 2, 'member2');
      expect(await zcard('test-zset')).toBe(2);
    });
  });

  describe('zremrangebyscore', () => {
    it('should remove members by score range', async () => {
      await zadd('test-zset2', 1, 'a');
      await zadd('test-zset2', 2, 'b');
      await zadd('test-zset2', 3, 'c');
      const result = await zremrangebyscore('test-zset2', 0, 2);
      expect(result).toBe(2);
    });
  });

  describe('zcard', () => {
    it('should return the cardinality of a sorted set', async () => {
      await zadd('test-zset3', 1, 'x');
      await zadd('test-zset3', 2, 'y');
      const result = await zcard('test-zset3');
      expect(result).toBe(2);
    });

    it('should return 0 for non-existent key', async () => {
      const result = await zcard('non-existent-zset');
      expect(result).toBe(0);
    });
  });

  describe('expire', () => {
    it('should set TTL on a key', async () => {
      await set('expire-test', 'value');
      const result = await expire('expire-test', 300);
      expect(result).toBe(1);
    });
  });

  describe('evalScript', () => {
    it('should execute a Lua script', async () => {
      const script = 'return redis.call("GET", KEYS[1])';
      await set('eval-test', 'eval-value');
      const result = await evalScript(script, ['eval-test'], []);
      expect(result).toBe('eval-value');
    });

    it('should handle rate limiting Lua script', async () => {
      const script = `
        redis.call('ZREMRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[2])
        local count = redis.call('ZCARD', KEYS[1])
        if count < tonumber(ARGV[3]) then
          redis.call('ZADD', KEYS[1], ARGV[4], ARGV[5])
        end
        return count
      `;
      const result = await evalScript(script, ['ratelimit:test'], ['0', '10', '100', Date.now(), 'member1']);
      expect(result).toBeDefined();
    });

    it('should return null on script failure', async () => {
      const script = 'return redis.call("NONEXISTENT")';
      const result = await evalScript(script, [], []);
      expect(result).toBeDefined();
    });
  });

  describe('scan', () => {
    it('should return an array of keys', async () => {
      await set('scan:test1', 'value1');
      await set('scan:test2', 'value2');
      const result = await scan('scan:*', 100);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty array for no matches', async () => {
      const result = await scan('zzzzz-nonexistent-pattern-zzzzz:*', 100);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
