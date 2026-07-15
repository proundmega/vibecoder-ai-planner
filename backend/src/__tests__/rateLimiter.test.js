const auth = require('../middleware/auth');

// Isolated redis mock for this test file only
jest.mock('../utils/redis', () => {
  const rateLimitState = new Map();
  const store = new Map();
  const sortedSets = new Map();
  const isAvailable = { value: true };

  const mockRedis = {
    get: jest.fn().mockImplementation((key) => {
      const val = store.get(key);
      return val !== undefined ? Promise.resolve(val) : Promise.resolve(null);
    }),
    set: jest.fn().mockImplementation((key, value, _ttl) => {
      store.set(key, value);
      return Promise.resolve(true);
    }),
    del: jest.fn().mockImplementation((key) => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    zadd: jest.fn().mockImplementation((key, score, member) => {
      if (!sortedSets.has(key)) {
        sortedSets.set(key, new Map());
      }
      const set = sortedSets.get(key);
      const wasNew = !set.has(member);
      set.set(member, score);
      return Promise.resolve(wasNew ? 1 : 0);
    }),
    zremrangebyscore: jest.fn().mockImplementation((key, min, max) => {
      if (!sortedSets.has(key)) return Promise.resolve(0);
      const set = sortedSets.get(key);
      let removed = 0;
      for (const [member, score] of set) {
        if (score >= min && score <= max) {
          set.delete(member);
          removed++;
        }
      }
      return Promise.resolve(removed);
    }),
    zcard: jest.fn().mockImplementation((key) => {
      if (!sortedSets.has(key)) return Promise.resolve(0);
      return Promise.resolve(sortedSets.get(key).size);
    }),
    expire: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockImplementation((cursor, ...args) => {
      const matchIdx = args.indexOf('MATCH');
      const matchPattern = matchIdx >= 0 ? args[matchIdx + 1] : '*';
      const regexPattern = '^' + matchPattern.replace(/\*/g, '.*') + '$';
      const regex = new RegExp(regexPattern);
      const results = [];
      for (const key of store.keys()) {
        if (regex.test(key)) {
          results.push(key);
        }
      }
      return Promise.resolve(['0', results]);
    }),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockImplementation((script, numKeys, ...args) => {
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);
      if (script.includes('ZREMRANGEBYSCORE') && script.includes('ZCARD')) {
        return Promise.resolve(simulateRateLimit(keys, argv));
      }
      if (script.includes('redis.call("GET"')) {
        const key = keys[0];
        const val = store.get(key);
        return Promise.resolve(val || null);
      }
      return Promise.resolve([0, 1, 60000]);
    }),
  };

  function simulateRateLimit(keys, args) {
    const [key] = keys;
    const windowStart = parseFloat(args[0]);
    const maxRequests = parseInt(args[1]);
    const now = parseFloat(args[2]);
    const timeWindow = parseFloat(args[3]);

    if (!rateLimitState.has(key)) {
      rateLimitState.set(key, []);
    }
    const entries = rateLimitState.get(key);
    const remaining = entries.filter(e => e > windowStart);
    rateLimitState.set(key, remaining);

    if (remaining.length >= maxRequests) {
      return [1, remaining.length, 0];
    }

    remaining.push(now);
    rateLimitState.set(key, remaining);
    return [0, remaining.length, timeWindow];
  }

  const mock = {
    connectRedis: jest.fn().mockReturnValue(mockRedis),
    ensureConnected: jest.fn().mockResolvedValue(true),
    closeRedis: jest.fn().mockResolvedValue(undefined),
    isRedisAvailable: jest.fn().mockImplementation(() => isAvailable.value),
    getRedis: jest.fn().mockReturnValue(mockRedis),
    get: jest.fn().mockImplementation((key) => mockRedis.get(key)),
    set: jest.fn().mockImplementation((key, value, ttl) => mockRedis.set(key, value, ttl)),
    del: jest.fn().mockImplementation((key) => mockRedis.del(key)),
    zadd: jest.fn().mockImplementation((key, score, member) => mockRedis.zadd(key, score, member)),
    zremrangebyscore: jest.fn().mockImplementation((key, min, max) => mockRedis.zremrangebyscore(key, min, max)),
    zcard: jest.fn().mockImplementation((key) => mockRedis.zcard(key)),
    expire: jest.fn().mockImplementation((key, ttl) => mockRedis.expire(key, ttl)),
    evalScript: jest.fn().mockImplementation((script, keys, args) => {
      if (script.includes('ZREMRANGEBYSCORE') && script.includes('ZCARD')) {
        return Promise.resolve(simulateRateLimit(keys, args));
      }
      if (script.includes('redis.call("GET"')) {
        const key = keys[0];
        const val = store.get(key);
        return Promise.resolve(val || null);
      }
      return Promise.resolve([0, 1, 60000]);
    }),
    scan: jest.fn().mockImplementation((match, count) => mockRedis.scan('0', 'MATCH', match, 'COUNT', count || 100)),
    getPrefixedKey: jest.fn().mockImplementation((key) => `vibecode:${key}`),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
    _resetRateLimitState: () => rateLimitState.clear(),
    _resetStore: () => store.clear(),
    _resetSortedSets: () => sortedSets.clear(),
    _rateLimitState: rateLimitState,
    _sortedSets: sortedSets,
    _isAvailable: isAvailable,
  };

  return mock;
});

describe('Rate Limiter Middleware', () => {
  let mockReq, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockReq = {
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    };
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) redisModule._resetRateLimitState();
    if (redisModule._resetStore) redisModule._resetStore();
    if (redisModule._resetSortedSets) redisModule._resetSortedSets();
    if (redisModule._isAvailable) redisModule._isAvailable.value = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should call next() on first request', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalled();
  });

  it('should call next() within rate limit', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalledTimes(2);
  });

  it('should block after exceeding rate limit', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    
    await limiter(mockReq, mockRes, nextFn);
    
    expect(nextFn).toHaveBeenCalledTimes(3);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Too many requests') })
    );
  });

  it('should set X-RateLimit-Limit header', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    expect(mockRes.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'X-RateLimit-Limit': '3' })
    );
  });

  it('should set X-RateLimit-Remaining header', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    const callArgs = mockRes.set.mock.calls[0][0];
    expect(callArgs['X-RateLimit-Remaining']).toBe('2');
  });

  it('should set X-RateLimit-Reset header', async () => {
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    const callArgs = mockRes.set.mock.calls[0][0];
    expect(callArgs['X-RateLimit-Reset']).toBeDefined();
  });

  it('should set Retry-After header on 429', async () => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    
    mockRes.set.mockClear();
    await limiter(mockReq, mockRes, nextFn);
    
    expect(mockRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('should track per IP address', async () => {
    const limiter = auth.rateLimiter(2, 1000);
    const req1 = { ip: '10.0.0.1' };
    const req2 = { ip: '10.0.0.2' };
    const res = createMockRes();
    const next = jest.fn();

    await limiter(req1, res, next);
    await limiter(req2, res, next);
    await limiter(req1, res, next);
    
    expect(next).toHaveBeenCalledTimes(3);
    
    await limiter(req1, res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('should reset after time window expires', async () => {
    jest.useFakeTimers();
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(3, 1000);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    await limiter(mockReq, mockRes, nextFn);
    
    expect(nextFn).toHaveBeenCalledTimes(3);
    
    jest.advanceTimersByTime(1100);
    
    await limiter(mockReq, mockRes, nextFn);
    expect(nextFn).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });

  it('should use different limits for different configurations', async () => {
    const strictLimiter = auth.rateLimiter(2, 1000);
    const req = { ip: '192.168.1.100' };
    const res = createMockRes();
    const next = jest.fn();

    await strictLimiter(req, res, next);
    await strictLimiter(req, res, next);
    
    res.status.mockClear();
    res.json.mockClear();
    
    await strictLimiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    
    const lenientLimiter = auth.rateLimiter(5, 1000);
    const req2 = { ip: '192.168.1.200' };
    const res2 = createMockRes();
    const next2 = jest.fn();

    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    await lenientLimiter(req2, res2, next2);
    expect(next2).toHaveBeenCalledTimes(5);
  });
});

describe('Account Lockout', () => {
  let originalAuthLockoutAttempts;
  
  beforeEach(() => {
    originalAuthLockoutAttempts = process.env.AUTH_LOCKOUT_ATTEMPTS;
    process.env.AUTH_LOCKOUT_ATTEMPTS = '10';
    jest.useRealTimers();
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    if (redisModule._isAvailable) {
      redisModule._isAvailable.value = true;
    }
  });

  afterEach(() => {
    if (originalAuthLockoutAttempts !== undefined) {
      process.env.AUTH_LOCKOUT_ATTEMPTS = originalAuthLockoutAttempts;
    } else {
      delete process.env.AUTH_LOCKOUT_ATTEMPTS;
    }
    jest.useRealTimers();
  });

  it('should not lock on first failed attempt', async () => {
    await auth.recordFailedAttempt('10.0.1.1');
    expect(await auth.checkAccountLockout('10.0.1.1')).toBe(false);
  });

  it('should not lock before reaching threshold', async () => {
    for (let i = 0; i < 9; i++) {
      await auth.recordFailedAttempt('10.0.1.2');
    }
    expect(await auth.checkAccountLockout('10.0.1.2')).toBe(false);
  });

  it('should lock after reaching threshold', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.3');
    }
    expect(await auth.checkAccountLockout('10.0.1.3')).toBe(true);
  });

  it('should track per IP', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.4');
    }
    expect(await auth.checkAccountLockout('10.0.1.4')).toBe(true);
    expect(await auth.checkAccountLockout('10.0.1.5')).toBe(false);
  });

  it('should unlock after lockout window', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.6');
    }
    expect(await auth.checkAccountLockout('10.0.1.6')).toBe(true);
    
    jest.useFakeTimers();
    jest.advanceTimersByTime(16 * 60 * 1000);
    
    expect(await auth.checkAccountLockout('10.0.1.6')).toBe(false);
    jest.useRealTimers();
  });

  it('should clear on successful login', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.7');
    }
    expect(await auth.checkAccountLockout('10.0.1.7')).toBe(true);
    
    auth.clearFailedAttempts('10.0.1.7');
    expect(await auth.checkAccountLockout('10.0.1.7')).toBe(false);
  });

  it('should return lockout remaining time', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.8');
    }
    const remaining = await auth.getLockoutRemainingMs('10.0.1.8');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('should return 0 remaining time when not locked', async () => {
    expect(await auth.getLockoutRemainingMs('10.0.1.99')).toBe(0);
  });

  it('should not increment count when already locked', async () => {
    for (let i = 0; i < 10; i++) {
      await auth.recordFailedAttempt('10.0.1.10');
    }
    const remaining1 = await auth.getLockoutRemainingMs('10.0.1.10');
    
    for (let i = 0; i < 5; i++) {
      await auth.recordFailedAttempt('10.0.1.10');
    }
    const remaining2 = await auth.getLockoutRemainingMs('10.0.1.10');
    
    expect(remaining2).toBeLessThanOrEqual(remaining1);
  });
});

describe('Rate Limiter — high-volume regression', () => {
  beforeEach(() => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    if (redisModule._isAvailable) {
      redisModule._isAvailable.value = true;
    }
  });

  it('should return 429 after 31 requests within 60 seconds', async () => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(30, 60000);
    const req = { ip: '10.0.2.1', connection: { remoteAddress: '10.0.2.1' } };
    const next = jest.fn();

    for (let i = 0; i < 31; i++) {
      await limiter(req, mockRes, next);
    }

    expect(next).toHaveBeenCalledTimes(30);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Too many requests') })
    );
  });

  it('should set Retry-After header on 429 response', async () => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    const mockRes = createMockRes();
    const limiter = auth.rateLimiter(30, 60000);
    const req = { ip: '10.0.2.2', connection: { remoteAddress: '10.0.2.2' } };
    const next = jest.fn();

    for (let i = 0; i < 31; i++) {
      await limiter(req, mockRes, next);
    }

    expect(mockRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });
});

function createMockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    set: jest.fn().mockReturnThis(),
  };
}
