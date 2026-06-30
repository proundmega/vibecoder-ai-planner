const request = require('supertest');
const app = require('../index');
const TemplateService = require('../services/TemplateService');
const Project = require('../models/project');

jest.mock('../services/TemplateService');
jest.mock('../models/project');
jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

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
      const res = await request(app)
        .get('/api/v1/tickets/1/planning')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });
});
