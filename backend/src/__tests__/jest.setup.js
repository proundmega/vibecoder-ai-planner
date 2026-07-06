// Winston mock
jest.mock('winston', () => {
  const MockConsole = jest.fn().mockImplementation(() => ({
    level: jest.fn(),
    format: jest.fn(),
    write: jest.fn()
  }));

  return {
    createLogger: jest.fn(() => ({
      level: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      format: {
        combine: jest.fn(() => ({ timestamp: jest.fn(), json: jest.fn() })),
        timestamp: jest.fn(),
        json: jest.fn(),
        colorize: jest.fn(),
        simple: jest.fn()
      },
      transports: [new MockConsole()],
      exit: jest.fn(),
      exitOnError: false
    })),
    format: {
      combine: jest.fn(() => ({ timestamp: jest.fn(), json: jest.fn() })),
      timestamp: jest.fn(),
      json: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn()
    },
    transports: {
      Console: MockConsole,
      File: MockConsole,
      Http: MockConsole,
      Stream: MockConsole
    }
  };
});

// logger mock
jest.mock('../utils/logger', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    maskSensitive: jest.fn((obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(item => mockLogger.maskSensitive(item));
      const SENSITIVE_FIELDS = ['password', 'token', 'apikey', 'authorization', 'secret', 'credit_card', 'ssn'];
      const masked = {};
      for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field))) {
          masked[key] = typeof value === 'string' && value.length > 3 ? value.substring(0, 3) + '***' : '***';
        } else {
          masked[key] = mockLogger.maskSensitive(value);
        }
      }
      return masked;
    }),
  };
  return mockLogger;
});

// pg.Pool mock
jest.mock('pg', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  };
  return { Pool: jest.fn().mockImplementation(() => pool) };
});

// bcryptjs mock
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('mock-hash'),
  compare: jest.fn().mockResolvedValue(true)
}));

// uuid mock
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid')
}));

// jwt mock
jest.mock('jsonwebtoken', () => {
  return {
    verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com' }),
    sign: jest.fn().mockReturnValue('mock-token')
  };
});

// Set required env vars for tests
process.env.JWT_SECRET = 'test-secret-key-at-least-32-chars-long';
process.env.DATABASE_URL = 'postgresql://localhost/test';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Redis mock
jest.mock('../utils/redis', () => {
  const rateLimitState = new Map();
  const store = new Map(); // For get/set/del operations

  const mockRedis = {
    get: jest.fn().mockImplementation((key) => {
      const val = store.get(key);
      return val !== undefined ? Promise.resolve(val) : Promise.resolve(null);
    }),
    set: jest.fn().mockImplementation((key, value, ttl) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn().mockImplementation((key) => {
      store.delete(key);
      return Promise.resolve(1);
    }),
    zadd: jest.fn().mockResolvedValue(1),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockImplementation((script, numKeys, ...args) => {
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);
      if (script.includes('ZREMRANGEBYSCORE') && script.includes('ZCARD')) {
        return Promise.resolve(simulateRateLimit(keys, argv));
      }
      return Promise.resolve([0, 1, 60000]);
    }),
  };

  // Simulate the Lua rate limiting script
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

    // Remove old entries outside the window
    const windowEnd = now - windowStart;
    const validEntries = entries.filter(e => e >= windowEnd);
    rateLimitState.set(key, validEntries);

    if (validEntries.length >= maxRequests) {
      return [1, validEntries.length, 0];
    }

    validEntries.push(now);
    rateLimitState.set(key, validEntries);
    return [0, validEntries.length, timeWindow];
  }

  const mock = {
    connectRedis: jest.fn().mockReturnValue(mockRedis),
    ensureConnected: jest.fn().mockResolvedValue(true),
    closeRedis: jest.fn().mockResolvedValue(undefined),
    isRedisAvailable: jest.fn().mockReturnValue(true),
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
      return Promise.resolve([0, 1, 60000]);
    }),
    scan: jest.fn().mockImplementation((match, count) => mockRedis.scan(match, count)),
    getPrefixedKey: jest.fn().mockImplementation((key) => `vibecode:${key}`),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
    _resetRateLimitState: () => rateLimitState.clear(),
    _resetStore: () => store.clear(),
    _rateLimitState: rateLimitState,
  };

  return mock;
});
