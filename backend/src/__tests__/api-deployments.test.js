const request = require('supertest');
const app = require('../index');

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn(),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/DeployService', () => ({
  listEnvironments: jest.fn().mockResolvedValue([]),
  createEnvironment: jest.fn().mockResolvedValue({ id: 'e1', name: 'production' }),
  deleteEnvironment: jest.fn().mockResolvedValue(undefined),
  triggerDeploy: jest.fn().mockResolvedValue({ id: 'd1', status: 'in_progress' }),
  rollbackDeployment: jest.fn().mockResolvedValue(undefined),
  updateDeploymentStatus: jest.fn().mockResolvedValue({ id: 'd1', status: 'deployed' }),
  getDeploymentHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text) => text ? `encrypted:${text}` : null),
  decrypt: jest.fn((text) => text?.replace('encrypted:', '') || ''),
  maskToken: jest.fn((text) => text ? text.substring(0, 3) + '***' : ''),
}));
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

jest.mock('../db', () => {
  const pool = {
    query: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  pool.query.mockResolvedValue({ rows: [] });
  return { pool };
});

describe('F4: Deployments router auth fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /projects/:id/environments - PROJECT_UPDATE permission', () => {
    it('should return 201 for project_admin (PROJECT_UPDATE permission granted)', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(true);
      
      const res = await request(app)
        .post('/api/v1/projects/1/environments')
        .set('Authorization', 'Bearer mock-token')
        .send({ name: 'production', webhook_url: 'https://example.com/webhook' });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 for user role without PROJECT_UPDATE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(false);
      
      const res = await request(app)
        .post('/api/v1/projects/1/environments')
        .set('Authorization', 'Bearer mock-token')
        .send({ name: 'production', webhook_url: 'https://example.com/webhook' });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('DELETE /environments/:id - PROJECT_UPDATE permission', () => {
    it('should return 200 for project_admin (PROJECT_UPDATE permission granted)', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(true);
      
      const res = await request(app)
        .delete('/api/v1/environments/1')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 for user role without PROJECT_UPDATE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(false);
      
      const res = await request(app)
        .delete('/api/v1/environments/1')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('POST /tickets/:id/deploy - TICKET_UPDATE permission', () => {
    it('should return 200 for user with TICKET_UPDATE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(true);
      
      const res = await request(app)
        .post('/api/v1/tickets/1/deploy')
        .set('Authorization', 'Bearer mock-token')
        .send({ environment_id: '00000000-0000-0000-0000-000000000001' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 for user without TICKET_UPDATE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(false);
      
      const res = await request(app)
        .post('/api/v1/tickets/1/deploy')
        .set('Authorization', 'Bearer mock-token')
        .send({ environment_id: '00000000-0000-0000-0000-000000000001' });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('POST /deployments/:id/rollback - TICKET_UPDATE permission', () => {
    it('should return 200 for user with TICKET_UPDATE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(true);
      
      const res = await request(app)
        .post('/api/v1/deployments/1/rollback')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 for user without TICKET_UPDATE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(false);
      
      const res = await request(app)
        .post('/api/v1/deployments/1/rollback')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('PATCH /deployments/:id/status - TICKET_STATUS_CHANGE permission', () => {
    it('should return 200 for user with TICKET_STATUS_CHANGE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(true);
      
      const res = await request(app)
        .patch('/api/v1/deployments/1/status')
        .set('Authorization', 'Bearer mock-token')
        .send({ status: 'success' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 for user without TICKET_STATUS_CHANGE permission', async () => {
      require('../services/PermissionService').hasAnyPermission.mockResolvedValue(false);
      
      const res = await request(app)
        .patch('/api/v1/deployments/1/status')
        .set('Authorization', 'Bearer mock-token')
        .send({ status: 'success' });

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });
  });

  describe('No token - all routes should return 401', () => {
    it('should return 401 for POST /projects/:id/environments without token', async () => {
      const res = await request(app)
        .post('/api/v1/projects/1/environments')
        .send({ name: 'production', webhook_url: 'https://example.com/webhook' });

      expect(res.statusCode).toBe(401);
    });

    it('should return 401 for POST /tickets/:id/deploy without token', async () => {
      const res = await request(app)
        .post('/api/v1/tickets/1/deploy')
        .send({ environment_id: '00000000-0000-0000-0000-000000000001' });

      expect(res.statusCode).toBe(401);
    });
  });
});
