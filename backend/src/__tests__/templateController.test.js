const TemplateService = require('../services/TemplateService');
const Project = require('../models/project');
const templateController = require('../controllers/templateController');

jest.mock('../services/TemplateService');
jest.mock('../models/project');

describe('Template Controller', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      params: { id: 'proj-1' },
      body: {},
      user: { userId: 1 },
    };
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe('listTemplates', () => {
    it('should return templates for a project', async () => {
      const templates = [{ id: 't1', name: 'Test Template' }];
      Project.findById.mockResolvedValue({ id: 'proj-1' });
      TemplateService.list.mockResolvedValue(templates);

      await templateController.listTemplates(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: templates,
      });
    });

    it('should return 404 when project not found', async () => {
      Project.findById.mockResolvedValue(null);

      await templateController.listTemplates(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('createTemplate', () => {
    it('should create a template with valid data', async () => {
      const newTemplate = { id: 't1', name: 'New Template' };
      req.body = {
        name: 'New Template',
        description: 'A test template',
        file_definitions: [{ key: 'test.md', content: 'content' }],
      };
      Project.findById.mockResolvedValue({ id: 'proj-1' });
      TemplateService.create.mockResolvedValue(newTemplate);

      await templateController.createTemplate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: newTemplate,
      });
    });

    it('should reject request without name', async () => {
      req.body = {
        file_definitions: [{ key: 'test.md', content: 'content' }],
      };
      Project.findById.mockResolvedValue({ id: 'proj-1' });

      await templateController.createTemplate(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject request without file_definitions', async () => {
      req.body = {
        name: 'Test',
      };
      Project.findById.mockResolvedValue({ id: 'proj-1' });

      await templateController.createTemplate(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should trim whitespace from name', async () => {
      const newTemplate = { id: 't1', name: 'Test' };
      req.body = {
        name: '  Test  ',
        file_definitions: [{ key: 'test.md', content: 'content' }],
      };
      Project.findById.mockResolvedValue({ id: 'proj-1' });
      TemplateService.create.mockResolvedValue(newTemplate);

      await templateController.createTemplate(req, res, next);

      expect(TemplateService.create).toHaveBeenCalledWith(
        'proj-1',
        'Test',
        undefined,
        [{ key: 'test.md', content: 'content' }],
        1
      );
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a template', async () => {
      const deletedTemplate = { id: 't1', name: 'Deleted Template' };
      req.params = { id: 't1' };
      TemplateService.delete.mockResolvedValue(deletedTemplate);

      await templateController.deleteTemplate(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: deletedTemplate,
      });
    });

    it('should return 404 when template not found', async () => {
      req.params = { id: 't1' };
      TemplateService.delete.mockResolvedValue(null);

      await templateController.deleteTemplate(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
