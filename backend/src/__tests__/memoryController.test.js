const memoryController = require('../controllers/memoryController');
const MemoryService = require('../services/MemoryService');

jest.mock('../services/MemoryService');

describe('MemoryController', () => {
  let req, res, nextFn;

  beforeEach(() => {
    jest.clearAllMocks();
    nextFn = jest.fn();
    req = {
      params: {},
      query: {},
      user: { userId: 1, role: 'project_admin' },
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe('addMemory', () => {
    test('should add memory with success wrapper', async () => {
      const mockMemory = {
        id: 1,
        projectId: 100,
        agentId: 1,
        content: 'Test memory',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      MemoryService.addMemory.mockResolvedValueOnce(mockMemory);

      req.params.projectId = '100';
      req.body = { content: 'Test memory', metadata: {} };

      await memoryController.addMemory(req, res, nextFn);

      expect(MemoryService.addMemory).toHaveBeenCalledWith(100, 1, 'Test memory', {});
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMemory,
      });
    });

    test('should return 400 if content is missing', async () => {
      req.params.projectId = '100';
      req.body = { metadata: {} };

      await memoryController.addMemory(req, res, nextFn);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Content is required',
        },
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Database error');
      MemoryService.addMemory.mockRejectedValueOnce(mockError);

      req.params.projectId = '100';
      req.body = { content: 'Test memory' };

      await memoryController.addMemory(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });

  describe('getMemory', () => {
    test('should return memory by id', async () => {
      const mockMemory = {
        id: 1,
        projectId: 100,
        agentId: 1,
        content: 'Test memory',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      MemoryService.getMemory.mockResolvedValueOnce(mockMemory);

      req.params.id = '1';

      await memoryController.getMemory(req, res, nextFn);

      expect(MemoryService.getMemory).toHaveBeenCalledWith(1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMemory,
      });
    });

    test('should return 404 for non-existent memory', async () => {
      MemoryService.getMemory.mockResolvedValueOnce(null);

      req.params.id = '999';

      await memoryController.getMemory(req, res, nextFn);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Memory not found',
        },
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Database error');
      MemoryService.getMemory.mockRejectedValueOnce(mockError);

      req.params.id = '1';

      await memoryController.getMemory(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });

  describe('getProjectMemory', () => {
    test('should return memories for a project', async () => {
      const mockMemories = [
        {
          id: 1,
          projectId: 100,
          agentId: 1,
          content: 'Memory 1',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      MemoryService.getProjectMemory.mockResolvedValueOnce(mockMemories);

      req.params.projectId = '100';

      await memoryController.getProjectMemory(req, res, nextFn);

      expect(MemoryService.getProjectMemory).toHaveBeenCalledWith(100, 50, 0);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMemories,
      });
    });

    test('should respect limit and offset query parameters', async () => {
      const mockMemories = [];

      MemoryService.getProjectMemory.mockResolvedValueOnce(mockMemories);

      req.params.projectId = '100';
      req.query = { limit: '10', offset: '5' };

      await memoryController.getProjectMemory(req, res, nextFn);

      expect(MemoryService.getProjectMemory).toHaveBeenCalledWith(100, 10, 5);
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Database error');
      MemoryService.getProjectMemory.mockRejectedValueOnce(mockError);

      req.params.projectId = '100';

      await memoryController.getProjectMemory(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });

  describe('searchMemory', () => {
    test('should search for similar memories', async () => {
      const mockMemories = [
        {
          id: 1,
          projectId: 100,
          agentId: 1,
          content: 'Similar memory',
          metadata: {},
          similarity: 0.85,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      MemoryService.searchSimilar.mockResolvedValueOnce(mockMemories);

      req.params.projectId = '100';
      req.query = { query: 'test query' };

      await memoryController.searchMemory(req, res, nextFn);

      expect(MemoryService.searchSimilar).toHaveBeenCalledWith(100, 'test query', 10, 0.3);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMemories,
      });
    });

    test('should return 400 if query is missing', async () => {
      req.params.projectId = '100';
      req.query = {};

      await memoryController.searchMemory(req, res, nextFn);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter is required',
        },
      });
    });

    test('should respect limit and threshold query parameters', async () => {
      const mockMemories = [];

      MemoryService.searchSimilar.mockResolvedValueOnce(mockMemories);

      req.params.projectId = '100';
      req.query = { query: 'test', limit: '5', threshold: '0.5' };

      await memoryController.searchMemory(req, res, nextFn);

      expect(MemoryService.searchSimilar).toHaveBeenCalledWith(100, 'test', 5, 0.5);
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Search failed');
      MemoryService.searchSimilar.mockRejectedValueOnce(mockError);

      req.params.projectId = '100';
      req.query = { query: 'test' };

      await memoryController.searchMemory(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });

  describe('updateMemory', () => {
    test('should update memory', async () => {
      const mockMemory = {
        id: 1,
        projectId: 100,
        agentId: 1,
        content: 'Updated content',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      MemoryService.updateMemory.mockResolvedValueOnce(mockMemory);

      req.params.id = '1';
      req.body = { content: 'Updated content', metadata: {} };

      await memoryController.updateMemory(req, res, nextFn);

      expect(MemoryService.updateMemory).toHaveBeenCalledWith(1, 'Updated content', {});
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMemory,
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Update failed');
      MemoryService.updateMemory.mockRejectedValueOnce(mockError);

      req.params.id = '1';
      req.body = { content: 'Updated content' };

      await memoryController.updateMemory(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });

  describe('deleteMemory', () => {
    test('should delete memory', async () => {
      const mockMemory = {
        id: 1,
        projectId: 100,
        agentId: 1,
        content: 'Deleted memory',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      MemoryService.deleteMemory.mockResolvedValueOnce(mockMemory);

      req.params.id = '1';

      await memoryController.deleteMemory(req, res, nextFn);

      expect(MemoryService.deleteMemory).toHaveBeenCalledWith(1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMemory,
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Delete failed');
      MemoryService.deleteMemory.mockRejectedValueOnce(mockError);

      req.params.id = '1';

      await memoryController.deleteMemory(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });
});
