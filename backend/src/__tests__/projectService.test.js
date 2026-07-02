const ProjectService = require('../services/ProjectService');
const Project = require('../models/project');
const { NotFoundError, ForbiddenError, ValidationError } = require('../errors/HttpError');

jest.mock('../models/project', () => ({
  findById: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../services/TicketService', () => ({
  findByProject: jest.fn(),
}));

describe('ProjectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('BP-51-03: Error types (NotFoundError/ForbiddenError)', () => {
    test('should throw NotFoundError when project not found on update', async () => {
      Project.findById.mockResolvedValue(null);

      await expect(ProjectService.update(1, { name: 'New Name' }, 100))
        .rejects
        .toThrow(NotFoundError);
    });

    test('should throw NotFoundError with correct message', async () => {
      Project.findById.mockResolvedValue(null);

      try {
        await ProjectService.update(1, { name: 'New Name' }, 100);
      } catch (err) {
        expect(err.message).toBe('Project not found');
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    test('should throw ForbiddenError when user is not owner on update', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 200 });

      await expect(ProjectService.update(1, { name: 'New Name' }, 100))
        .rejects
        .toThrow(ForbiddenError);
    });

    test('should throw ForbiddenError with correct message', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 200 });

      try {
        await ProjectService.update(1, { name: 'New Name' }, 100);
      } catch (err) {
        expect(err.message).toBe('Unauthorized');
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('FORBIDDEN');
      }
    });

    test('should not throw on update when user is owner', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      Project.update.mockResolvedValue({ id: 1, name: 'Updated' });

      const result = await ProjectService.update(1, { name: 'Updated' }, 100);
      expect(result).toEqual({ id: 1, name: 'Updated' });
    });
  });

  describe('BP-51-05: Explicit field mapping instead of Object.values', () => {
    test('should pass name and description in correct order regardless of object key order', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      Project.update.mockResolvedValue({ id: 1, name: 'Test', description: 'Desc' });

      // Pass fields in reverse order - Object.values() would get them wrong
      await ProjectService.update(1, { description: 'Desc', name: 'Test' }, 100);

      expect(Project.update).toHaveBeenCalledWith(1, 'Test', 'Desc', 100);
    });

    test('should pass name first, description second, userId third', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      Project.update.mockResolvedValue({ id: 1 });

      await ProjectService.update(1, { name: 'Alpha', description: 'Beta' }, 100);

      expect(Project.update).toHaveBeenCalledWith(1, 'Alpha', 'Beta', 100);
    });

    test('should not be affected by object enumeration order changes', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      Project.update.mockResolvedValue({ id: 1 });

      // Even with many fields, only name and description should be passed
      await ProjectService.update(1, {
        zField: 'z',
        aField: 'a',
        name: 'Correct Name',
        mField: 'm',
        description: 'Correct Description',
      }, 100);

      expect(Project.update).toHaveBeenCalledWith(1, 'Correct Name', 'Correct Description', 100);
    });
  });

  describe('delete', () => {
    test('should throw NotFoundError when project not found', async () => {
      Project.findById.mockResolvedValue(null);

      await expect(ProjectService.delete(1, 100))
        .rejects
        .toThrow(NotFoundError);
    });

    test('should throw ForbiddenError when user is not owner', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 200 });

      await expect(ProjectService.delete(1, 100))
        .rejects
        .toThrow(ForbiddenError);
    });

    test('should throw ValidationError when project has tickets', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      ProjectService.findByProject = require('../services/TicketService').findByProject;
      require('../services/TicketService').findByProject.mockResolvedValue([{ id: 't1' }]);

      await expect(ProjectService.delete(1, 100))
        .rejects
        .toThrow(ValidationError);
    });
  });
});
