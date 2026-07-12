const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

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

describe('IP Whitelist Route Permissions (bp-72 Issue 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const jwt = require('jsonwebtoken');
    jwt.verify.mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'user' });
    const redisModule = require('../utils/redis');
    if (redisModule._resetRateLimitState) {
      redisModule._resetRateLimitState();
    }
  });

  it('USER_VIEW_ALL role cannot create whitelist entries (requires USER_UPDATE)', async () => {
    const jwt = require('jsonwebtoken');
    jwt.verify.mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'user' });
    
    const res = await request(app)
      .post('/api/v1/admin/ip-whitelist')
      .set('Authorization', 'Bearer fake-token')
      .send({ ip_address: '10.0.0.1', description: 'test' });
    
    expect(res.status).toBe(403);
  });

  it('USER_VIEW_ALL role cannot delete whitelist entries (requires USER_UPDATE)', async () => {
    const jwt = require('jsonwebtoken');
    jwt.verify.mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'user' });
    
    const res = await request(app)
      .delete('/api/v1/admin/ip-whitelist/1')
      .set('Authorization', 'Bearer fake-token');
    
    expect(res.status).toBe(403);
  });

  it('user role cannot create whitelist entries (requires USER_UPDATE)', async () => {
    const jwt = require('jsonwebtoken');
    jwt.verify.mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'user' });
    
    const res = await request(app)
      .post('/api/v1/admin/ip-whitelist')
      .set('Authorization', 'Bearer fake-token')
      .send({ ip_address: '10.0.0.1', description: 'test' });
    
    expect(res.status).toBe(403);
  });

  it('user role cannot delete whitelist entries (requires USER_UPDATE)', async () => {
    const jwt = require('jsonwebtoken');
    jwt.verify.mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'user' });
    
    const res = await request(app)
      .delete('/api/v1/admin/ip-whitelist/1')
      .set('Authorization', 'Bearer fake-token');
    
    expect(res.status).toBe(403);
  });
});
