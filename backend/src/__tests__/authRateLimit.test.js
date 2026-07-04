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

describe('GET /auth/me rate limiter (BP-60)', () => {
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
