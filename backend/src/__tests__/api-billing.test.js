const request = require('supertest');
const app = require('../index');
const BillingService = require('../services/BillingService');
const Project = require('../models/project');

jest.mock('../services/BillingService', () => ({
  aggregateDailyBilling: jest.fn().mockResolvedValue(1),
  getProjectBilling: jest.fn(),
  getProjectBillingRange: jest.fn(),
  getUserBilling: jest.fn(),
}));
jest.mock('../models/project', () => ({
  findById: jest.fn().mockResolvedValue({ id: 1, name: 'Test Project' }),
}));
jest.mock('../controllers/billingController', () => ({
  getProjectBilling: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  getUserBilling: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
}));
jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  pool.query.mockImplementation((sql) => {
    if (sql.includes('INSERT INTO provider_configs')) {
      return Promise.resolve({
        rows: [{
          id: 'pc-1',
          project_id: 1,
          provider: 'openai',
          endpoint_url: null,
          model: 'gpt-4',
          api_key_encrypted: null,
          fallback_provider: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });
    }
    if (sql.includes('SELECT * FROM provider_configs')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { pool };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'super_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

describe('Billing API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    BillingService.aggregateDailyBilling.mockResolvedValue(1);
  });

  describe('POST /api/v1/billing/aggregate', () => {
    it('should trigger aggregation and return 200', async () => {
      const res = await request(app)
        .post('/api/v1/billing/aggregate')
        .set('Authorization', 'Bearer mock-token')
        .send({ date: '2026-07-20' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.date).toBe('2026-07-20');
      expect(BillingService.aggregateDailyBilling).toHaveBeenCalledWith(
        expect.any(Date)
      );
    });

    it('should default to yesterday when no date provided', async () => {
      const res = await request(app)
        .post('/api/v1/billing/aggregate')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(BillingService.aggregateDailyBilling).toHaveBeenCalledWith(
        expect.any(Date)
      );
      const callDate = BillingService.aggregateDailyBilling.mock.calls[0][0];
      const yesterday = new Date(Date.now() - 86400000);
      expect(callDate.toISOString().split('T')[0]).toBe(yesterday.toISOString().split('T')[0]);
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .post('/api/v1/billing/aggregate');

      expect(res.statusCode).toBe(401);
      expect(BillingService.aggregateDailyBilling).not.toHaveBeenCalled();
    });

    it('should return 403 for user role without sufficient permissions', async () => {
      const PermissionService = require('../services/PermissionService');
      PermissionService.hasAnyPermission.mockResolvedValueOnce(false);

      const res = await request(app)
        .post('/api/v1/billing/aggregate')
        .set('Authorization', 'Bearer mock-token');

      // User role doesn't have PROJECT_ADMIN or SUPER_ADMIN
      expect(res.statusCode).toBe(403);
      expect(BillingService.aggregateDailyBilling).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/billing/projects/:id/billing', () => {
    it('should return billing for a project', async () => {
      const res = await request(app)
        .get('/api/v1/billing/projects/1/billing')
        .set('Authorization', 'Bearer mock-token')
        .query({ month: '2026-06-01' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/v1/billing/users/me/billing', () => {
    it('should return billing for current user', async () => {
      const res = await request(app)
        .get('/api/v1/billing/users/me/billing')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
