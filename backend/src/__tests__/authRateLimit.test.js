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

// Redis mock for supertest tests
jest.mock('../utils/redis', () => {
  const rateLimitState = new Map();

  return {
    connectRedis: jest.fn(),
    ensureConnected: jest.fn().mockResolvedValue(true),
    closeRedis: jest.fn().mockResolvedValue(undefined),
    isRedisAvailable: jest.fn().mockReturnValue(true),
    getRedis: jest.fn().mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') }),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    zadd: jest.fn().mockResolvedValue(1),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    evalScript: jest.fn().mockImplementation((script, keys, args) => {
      if (script.includes('ZREMRANGEBYSCORE') && script.includes('ZCARD')) {
        const [key] = keys;
        const maxRequests = parseInt(args[1]);
        const now = parseFloat(args[2]);

        if (!rateLimitState.has(key)) {
          rateLimitState.set(key, []);
        }
        const entries = rateLimitState.get(key);

        if (entries.length >= maxRequests) {
          return Promise.resolve([1, entries.length, 0]);
        }

        entries.push(now);
        return Promise.resolve([0, entries.length, 60000]);
      }
      return Promise.resolve([0, 1, 60000]);
    }),
    scan: jest.fn().mockResolvedValue(['0', []]),
    getPrefixedKey: jest.fn().mockImplementation((key) => `vibecode:${key}`),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' }),
    _resetRateLimitState: () => rateLimitState.clear(),
  };
});

describe('GET /auth/me rate limiter (BP-60)', () => {
  beforeEach(() => {
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
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
