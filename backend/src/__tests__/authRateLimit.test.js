const request = require('supertest');
const app = require('../index');

// Mock dependencies for supertest
jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

jest.mock('../models/user', () => ({
  find: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@test.com', name: 'Test User', role: 'project_admin', currentPlan: 'starter', isActive: true }),
}));

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text) => text ? `encrypted:${text}` : null),
  decrypt: jest.fn((text) => text?.replace('encrypted:', '') || ''),
  maskToken: jest.fn((text) => text ? text.substring(0, 3) + '***' : ''),
}));

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

describe('GET /auth/me rate limiter (BP-60)', () => {
  beforeEach(() => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
    if (redisModule._resetStore) {
      redisModule._resetStore();
    }
    if (redisModule._resetSortedSets) {
      redisModule._resetSortedSets();
    }
    if (redisModule._isAvailable) {
      redisModule._isAvailable.value = true;
    }
  });

  it('returns 429 after exceeding rate limit (30 requests per 60s)', async () => {
    const token = `ratelimit-test-${Date.now()}`;
    
    // Make 31 requests (rate limit is 30 per 60s for /auth/me)
    const results = [];
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      results.push(res);
    }
    
    // Count status codes
    const statusCounts = {};
    results.forEach(r => {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    });
    
    // First 30 should succeed (200)
    expect(statusCounts[200] || 0).toBe(30);
    
    // 31st should be rate limited (429)
    expect(statusCounts[429] || 0).toBe(1);
    
    // The rate limited response should have retry-after info
    const rateLimited = results.filter(r => r.status === 429);
    expect(rateLimited.length).toBe(1);
    expect(rateLimited[0].body.error).toBe('Too many requests, please try again later.');
    expect(rateLimited[0].body.retryAfter).toBe(60);
  });
});
