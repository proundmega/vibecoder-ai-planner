const MemoryService = require('../services/MemoryService');
const { NotFoundError } = require('../errors/HttpError');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

describe('MemoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete global.fetch;
    MemoryService._memoryTableAvailable = true;
  });

  describe('addMemory', () => {
    test('should add memory without embedding when no API key', async () => {
      const mockRow = {
        id: 1,
        project_id: 100,
        agent_id: 1,
        content: 'Test memory content',
        embedding: null,
        metadata: JSON.stringify({ type: 'note' }),
        created_at: new Date(),
        updated_at: new Date(),
      };

      require('../db').pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MemoryService.addMemory(100, 1, 'Test memory content', { type: 'note' });

      expect(result).toEqual({
        id: 1,
        projectId: 100,
        agentId: 1,
        content: 'Test memory content',
        embedding: null,
        metadata: { type: 'note' },
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [100, 1, 'Test memory content', null, JSON.stringify({ type: 'note' })]
      );
    });

    test('should add memory with embedding when API key is set', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

      const mockRow = {
        id: 1,
        project_id: 100,
        agent_id: 1,
        content: 'Test memory content',
        embedding: [0.1, 0.2, 0.3],
        metadata: JSON.stringify({}),
        created_at: new Date(),
        updated_at: new Date(),
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      });

      require('../db').pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MemoryService.addMemory(100, 1, 'Test memory content');

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe('getMemory', () => {
    test('should return memory by id', async () => {
      const mockRow = {
        id: 1,
        project_id: 100,
        agent_id: 1,
        content: 'Test memory',
        embedding: null,
        metadata: JSON.stringify({}),
        created_at: new Date(),
        updated_at: new Date(),
      };

      require('../db').pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MemoryService.getMemory(1);

      expect(result).toEqual({
        id: 1,
        projectId: 100,
        agentId: 1,
        content: 'Test memory',
        embedding: null,
        metadata: {},
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    test('should return null for non-existent memory', async () => {
      require('../db').pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await MemoryService.getMemory(999);

      expect(result).toBeNull();
    });
  });

  describe('getProjectMemory', () => {
    test('should return memories for a project', async () => {
      const mockRows = [
        {
          id: 1,
          project_id: 100,
          agent_id: 1,
          content: 'Memory 1',
          embedding: null,
          metadata: JSON.stringify({}),
          created_at: new Date(),
          updated_at: new Date(),
          agent_name: 'Agent 1',
          agent_email: 'agent1@test.com',
        },
      ];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MemoryService.getProjectMemory(100);

      expect(result).toHaveLength(1);
      expect(result[0].agentName).toBe('Agent 1');
      expect(result[0].agentEmail).toBe('agent1@test.com');
    });

    test('should respect limit and offset', async () => {
      const mockRows = [];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      await MemoryService.getProjectMemory(100, 10, 5);

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [100, 10, 5]
      );
    });
  });

  describe('getAgentMemory', () => {
    test('should return memories for an agent', async () => {
      const mockRows = [
        {
          id: 1,
          project_id: 100,
          agent_id: 1,
          content: 'Memory 1',
          embedding: null,
          metadata: JSON.stringify({}),
          created_at: new Date(),
          updated_at: new Date(),
          agent_name: 'Agent 1',
          agent_email: 'agent1@test.com',
        },
      ];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MemoryService.getAgentMemory(1);

      expect(result).toHaveLength(1);
    });

    test('should respect limit and offset', async () => {
      const mockRows = [];

      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      await MemoryService.getAgentMemory(1, 10, 5);

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        expect.any(String),
        [1, 10, 5]
      );
    });
  });

  describe('updateMemory', () => {
    test('should update memory content and regenerate embedding', async () => {
      const mockRow = {
        id: 1,
        project_id: 100,
        agent_id: 1,
        content: 'Updated content',
        embedding: [0.4, 0.5, 0.6],
        metadata: JSON.stringify({}),
        created_at: new Date(),
        updated_at: new Date(),
      };

      process.env.OPENAI_API_KEY = 'test-key';
      process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ embedding: [0.4, 0.5, 0.6] }],
        }),
      });

      // First query is getMemory, second is UPDATE
      require('../db').pool.query
        .mockResolvedValueOnce({ rows: [mockRow] })
        .mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MemoryService.updateMemory(1, 'Updated content', {});

      expect(result.content).toBe('Updated content');
      expect(result.embedding).toEqual([0.4, 0.5, 0.6]);
    });

    test('should throw NotFoundError for non-existent memory', async () => {
      require('../db').pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(MemoryService.updateMemory(999, 'Content', {})).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteMemory', () => {
    test('should delete a memory', async () => {
      const mockRow = {
        id: 1,
        project_id: 100,
        agent_id: 1,
        content: 'Deleted memory',
        embedding: null,
        metadata: JSON.stringify({}),
        created_at: new Date(),
        updated_at: new Date(),
      };

      require('../db').pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await MemoryService.deleteMemory(1);

      expect(result.id).toBe(1);
    });

    test('should throw NotFoundError for non-existent memory', async () => {
      require('../db').pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(MemoryService.deleteMemory(999)).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteProjectMemory', () => {
    test('should delete all memories for a project', async () => {
      require('../db').pool.query.mockResolvedValueOnce({ rows: [] });

      await MemoryService.deleteProjectMemory(100);

      expect(require('../db').pool.query).toHaveBeenCalledWith(
        'DELETE FROM agent_memory WHERE project_id = $1',
        [100]
      );
    });
  });
});
