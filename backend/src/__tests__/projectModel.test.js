const { pool } = require('../db');
const Project = require('../models/project');

jest.mock('../db', () => {
  const mockPool = {
    query: jest.fn(),
    transaction: jest.fn(),
  };
  return {
    pool: mockPool,
    connect: jest.fn(),
    transaction: mockPool.transaction,
  };
});

describe('Project Model - JOIN Behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return project with owner_name when user exists (INNER JOIN match)', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 1,
          name: 'Test Project',
          description: 'Test desc',
          owner_id: 100,
          owner_name: 'Owner User',
          created_at: new Date(),
        }],
      });

      const result = await Project.findById(1);

      expect(result).toBeInstanceOf(Project);
      expect(result.id).toBe(1);
      expect(result.name).toBe('Test Project');
      expect(result.ownerId).toBe(100);
      expect(result.ownerName).toBe('Owner User');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN users'),
        [1]
      );
    });

    it('should return project when owner user is deleted or missing (LEFT JOIN null)', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 2,
          name: 'Orphan Project',
          description: 'Owner was deleted',
          owner_id: 999,
          owner_name: null,
          created_at: new Date(),
        }],
      });

      const result = await Project.findById(2);

      expect(result).toBeInstanceOf(Project);
      expect(result.id).toBe(2);
      expect(result.name).toBe('Orphan Project');
      expect(result.ownerId).toBe(999);
      expect(result.ownerName).toBeNull();
    });

    it('should return project when owner_id is NULL (LEFT JOIN null)', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          id: 3,
          name: 'No Owner Project',
          description: 'No owner assigned',
          owner_id: null,
          owner_name: null,
          created_at: new Date(),
        }],
      });

      const result = await Project.findById(3);

      expect(result).toBeInstanceOf(Project);
      expect(result.id).toBe(3);
      expect(result.ownerId).toBeNull();
      expect(result.ownerName).toBeNull();
    });

    it('should return null when project does not exist', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await Project.findById(999);

      expect(result).toBeNull();
    });

    it('should return null for soft-deleted projects', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await Project.findById(1);

      expect(result).toBeNull();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND p.deleted_at IS NULL'),
        [1]
      );
    });
  });

  describe('findAll', () => {
    it('should return projects with owner_name when users exist', async () => {
      pool.query.mockResolvedValue({
        rows: [
          {
            id: 1,
            name: 'Project 1',
            description: 'Desc 1',
            owner_id: 100,
            owner_name: 'Owner 1',
            created_at: new Date(),
          },
          {
            id: 2,
            name: 'Project 2',
            description: 'Desc 2',
            owner_id: 200,
            owner_name: 'Owner 2',
            created_at: new Date(),
          },
        ],
      });

      const results = await Project.findAll(100);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Project 1');
      expect(results[0].ownerName).toBe('Owner 1');
    });

    it('should return projects even when owner user is missing (LEFT JOIN)', async () => {
      pool.query.mockResolvedValue({
        rows: [
          {
            id: 1,
            name: 'Orphan Project',
            description: 'Owner deleted',
            owner_id: 999,
            owner_name: null,
            created_at: new Date(),
          },
        ],
      });

      const results = await Project.findAll(100);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(1);
      expect(results[0].ownerId).toBe(999);
      expect(results[0].ownerName).toBeNull();
    });

    it('should return empty array when user has no projects', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const results = await Project.findAll(100);

      expect(results).toEqual([]);
    });

    it('should filter soft-deleted projects', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await Project.findAll(100);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND p.deleted_at IS NULL'),
        [100]
      );
    });
  });

  describe('fromRow', () => {
    it('should handle row with null owner_name from LEFT JOIN', () => {
      const row = {
        id: 1,
        name: 'Test',
        description: 'Desc',
        owner_id: 999,
        owner_name: null,
        created_at: new Date(),
      };

      const result = Project.fromRow(row);

      expect(result.ownerId).toBe(999);
      expect(result.ownerName).toBeNull();
    });

    it('should handle row with valid owner_name', () => {
      const row = {
        id: 1,
        name: 'Test',
        description: 'Desc',
        owner_id: 100,
        owner_name: 'Admin',
        created_at: new Date(),
      };

      const result = Project.fromRow(row);

      expect(result.ownerId).toBe(100);
      expect(result.ownerName).toBe('Admin');
    });
  });
});
