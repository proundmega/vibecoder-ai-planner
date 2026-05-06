const ProjectService = require('./ProjectService');

describe('ProjectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create project successfully', async () => {
      const project = await ProjectService.create('Test Project', 'Description', 'user-1');
      expect(project).toBeDefined();
      expect(project.name).toBe('Test Project');
    });
  });

  describe('findById', () => {
    it('should retrieve project by ID', async () => {
      const project = await ProjectService.findById('p1');
      expect(project).toBeDefined();
    });

    it('should throw error for non-existent project', async () => {
      await expect(ProjectService.findById('nonexistent'))
        .rejects
        .toThrow('Project not found');
    });
  });

  describe('findAll', () => {
    it('should return array of projects', async () => {
      const projects = await ProjectService.findAll('user-1');
      expect(Array.isArray(projects)).toBe(true);
    });
  });

  describe('update', () => {
    it('should update project name', async () => {
      await ProjectService.update('p1', 'New Name', null);
    });

    it('should update project description', async () => {
      await ProjectService.update('p1', null, 'New Desc');
    });
  });

  describe('share', () => {
    it('should add project membership', async () => {
      await ProjectService.share('p1', 'user-2');
    });
  });
});
