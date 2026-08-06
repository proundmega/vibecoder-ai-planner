const request = require('supertest');
const app = require('../index');
const TemplateService = require('../services/TemplateService');
const Project = require('../models/project');

jest.mock('../services/TemplateService');
jest.mock('../services/TicketPlanningService');
jest.mock('../models/project');
jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/ProvisioningService', () => ({
  testConnection: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/MilestoneService', () => ({
  list: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 'm1', name: 'Test Milestone' }),
  update: jest.fn().mockResolvedValue({ id: 'm1', name: 'Updated Milestone' }),
  getTickets: jest.fn().mockResolvedValue([]),
  getProgress: jest.fn().mockResolvedValue({ progress: 0 }),
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

jest.mock('../db', () => {
  const pool = {
    query: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  pool.query.mockImplementation((sql, _params) => {
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
          routing_rules: {},
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });
    }
    if (sql.includes('SELECT t.id, t.project_id, p.name as project_name FROM tickets t JOIN projects p')) {
      return Promise.resolve({ rows: [{ id: 1, project_id: 1, project_name: 'Test' }] });
    }
    if (sql.includes('usage_logs') && sql.includes('planning_stage')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('usage_logs') && sql.includes('file_key')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('ticket_planning') && sql.includes('last_tokens_in')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('SELECT * FROM provider_configs')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { pool };
});

// Override jwt mock to return a user with role for these tests
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

describe('Route Ordering', () => {
  describe('sub-routes must be defined before router.use mounts', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      Project.findById.mockResolvedValue({ id: 1, name: 'Test Project' });
      TemplateService.list.mockResolvedValue([{ id: 't1', name: 'Template 1' }]);
      TemplateService.create.mockResolvedValue({ id: 't2', name: 'New Template' });
      TemplateService.delete.mockResolvedValue({ id: 't1', name: 'Deleted' });
    });

    it('should route GET /api/v1/projects/1/templates to templateController.listTemplates', async () => {
      const res = await request(app)
        .get('/api/v1/projects/1/templates')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([{ id: 't1', name: 'Template 1' }]);
    });

    it('should route POST /api/v1/projects/1/templates to templateController.createTemplate', async () => {
      const res = await request(app)
        .post('/api/v1/projects/1/templates')
        .set('Authorization', 'Bearer mock-token')
        .send({
          name: 'New Template',
          file_definitions: [{ key: 'test.md', content: 'content' }],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('New Template');
    });

    it('should route DELETE /api/v1/projects/1/templates/t1 to templateController.deleteTemplate', async () => {
      const res = await request(app)
        .delete('/api/v1/projects/1/templates/t1')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Deleted');
    });

    it('should pass templateId (not projectId) to TemplateService.delete', async () => {
      TemplateService.delete.mockResolvedValue({ id: 't1', name: 'Deleted' });
      const res = await request(app)
        .delete('/api/v1/projects/42/templates/t99')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      // First arg must be templateId 't99', not projectId '42'
      const calls = TemplateService.delete.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe('t99');
    });

    it('should route GET /api/v1/providers/projects/1/provider to deprecation handler (410 Gone)', async () => {
      const res = await request(app)
        .get('/api/v1/providers/projects/1/provider')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DEPRECATED');
    });

    it('should route PUT /api/v1/providers/projects/1/provider to deprecation handler (410 Gone)', async () => {
      const res = await request(app)
        .put('/api/v1/providers/projects/1/provider')
        .set('Authorization', 'Bearer mock-token')
        .send({ provider: 'openai', model: 'gpt-4' });

      expect(res.statusCode).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DEPRECATED');
    });

    it('should route GET /api/v1/projects/1 to projectsRouter.getProject', async () => {
      Project.findById.mockResolvedValue({
        id: 1,
        name: 'Test Project',
        description: 'A test project',
        owner_id: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app)
        .get('/api/v1/projects/1')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Project');
    });

    it('should route GET /api/v1/tickets/1/attachments to ticketAttachmentController.list', async () => {
      const ticketAttachmentController = require('../controllers/ticketAttachmentController');
      ticketAttachmentController.list = jest.fn((req, res) => {
        res.json({ success: true, data: [{ id: 'a1', filename: 'test.txt' }] });
      });

      const res = await request(app)
        .get('/api/v1/tickets/1/attachments')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([{ id: 'a1', filename: 'test.txt' }]);
    });

    it('should route GET /api/v1/tickets/1/planning to ticketPlanningController.list', async () => {
      const TicketPlanningService = require('../services/TicketPlanningService');
      TicketPlanningService.list.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/tickets/1/planning')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should route POST /api/v1/tickets/1/planning/apply-template to ticketPlanningController.applyTemplate', async () => {
      const TicketPlanningService = require('../services/TicketPlanningService');
      const TemplateService = require('../services/TemplateService');
      
      const mockTemplateFiles = [
        { key: '00_CHECKLIST.md', content: '# Checklist' },
        { key: '01_REQUIREMENT.md', content: '# Requirement' },
      ];
      TemplateService.getArchitectTemplate.mockReturnValue(mockTemplateFiles);
      TemplateService.getArchitectTemplateContent.mockImplementation((key) => {
        const file = mockTemplateFiles.find(f => f.key === key);
        return file ? file.content : '';
      });
      TicketPlanningService.applyTemplate.mockResolvedValue(mockTemplateFiles);

      const res = await request(app)
        .post('/api/v1/tickets/1/planning/apply-template')
        .set('Authorization', 'Bearer mock-token')
        .send({ templateName: 'architecture' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockTemplateFiles);
      expect(res.body.message).toBe('Template applied successfully');
    });

    it('should return 400 for POST /api/v1/tickets/1/planning/apply-template without templateName', async () => {
      const res = await request(app)
        .post('/api/v1/tickets/1/planning/apply-template')
        .set('Authorization', 'Bearer mock-token')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('templateName is required');
    });

    it('should accept "architecture" (not "architect") as valid template name', async () => {
      const TicketPlanningService = require('../services/TicketPlanningService');
      const TemplateService = require('../services/TemplateService');
      
      const mockTemplateFiles = [
        { key: '00_CHECKLIST.md', content: '# Checklist' },
      ];
      TemplateService.getArchitectTemplate.mockReturnValue(mockTemplateFiles);
      TemplateService.getArchitectTemplateContent.mockImplementation((key) => {
        const file = mockTemplateFiles.find(f => f.key === key);
        return file ? file.content : '';
      });
      TicketPlanningService.applyTemplate.mockResolvedValue(mockTemplateFiles);

      const res = await request(app)
        .post('/api/v1/tickets/1/planning/apply-template')
        .set('Authorization', 'Bearer mock-token')
        .send({ templateName: 'architecture' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockTemplateFiles);
    });

    describe('F2/F3/F4: Mounted routers must not return 404', () => {
      it('should route GET /api/v1/compute-nodes to computeNodesRouter (200, not 404)', async () => {
        const res = await request(app)
          .get('/api/v1/compute-nodes')
          .set('Authorization', 'Bearer mock-token');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should route GET /api/v1/projects/1/milestones to milestonesRouter (200, not 404)', async () => {
        const res = await request(app)
          .get('/api/v1/projects/1/milestones')
          .set('Authorization', 'Bearer mock-token');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should route GET /api/v1/tickets/1/deployments to deploymentsRouter (200, not 404)', async () => {
        const res = await request(app)
          .get('/api/v1/tickets/1/deployments')
          .set('Authorization', 'Bearer mock-token');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should route POST /api/v1/projects/1/environments to deploymentsRouter (201, not 404)', async () => {
        const res = await request(app)
          .post('/api/v1/projects/1/environments')
          .set('Authorization', 'Bearer mock-token')
          .send({ name: 'production', webhook_url: 'https://example.com/webhook' });

        expect(res.statusCode).toBe(201);
        expect(res.body.success).toBe(true);
      });
    });

    describe('F5: Usage routes must not be shadowed by :fileKey catch-all', () => {
      it('should route GET /api/v1/tickets/1/planning/usage (not treated as fileKey)', async () => {
        const res = await request(app)
          .get('/api/v1/tickets/1/planning/usage')
          .set('Authorization', 'Bearer mock-token');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ticketId).toBe(1);
      });

      it('should route GET /api/v1/tickets/1/planning/some%2Ffile/usage (not treated as fileKey)', async () => {
        const res = await request(app)
          .get('/api/v1/tickets/1/planning/some%2Ffile/usage')
          .set('Authorization', 'Bearer mock-token');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.fileKey).toBe('some/file');
      });
    });
  });
});
