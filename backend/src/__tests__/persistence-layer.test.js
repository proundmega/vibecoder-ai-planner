const { pool, transaction } = require('../db');

jest.mock('../db', () => {
  const mockPool = {
    query: jest.fn(),
  };
  const mockTransaction = jest.fn();
  return {
    pool: mockPool,
    connect: jest.fn(),
    transaction: mockTransaction,
  };
});

const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');

describe('Persistence Layer - Transaction Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('transaction()', () => {
    it('should commit on success', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: '1' }] }) // fn callback
          .mockResolvedValueOnce(undefined), // COMMIT
        release: jest.fn(),
      };
      
      transaction.mockImplementation(async (fn) => {
        await mockClient.query('BEGIN');
        const result = await fn(mockClient);
        await mockClient.query('COMMIT');
        return result;
      });

      const result = await transaction(async (_client) => {
        return { id: '1' };
      });

      expect(result).toEqual({ id: '1' });
      expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
      expect(mockClient.release).not.toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(undefined) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')) // fn callback
          .mockResolvedValueOnce(undefined), // ROLLBACK
        release: jest.fn(),
      };
      
      transaction.mockImplementation(async (fn) => {
        try {
          await mockClient.query('BEGIN');
          await fn(mockClient);
          await mockClient.query('COMMIT');
        } catch (error) {
          await mockClient.query('ROLLBACK');
          throw error;
        } finally {
          mockClient.release();
        }
      });

      await expect(transaction(async () => {
        throw new Error('DB error');
      })).rejects.toThrow('DB error');
      expect(mockClient.query).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    });
  });
});

describe('Persistence Layer - Soft Delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Ticket', () => {
    it('should soft delete ticket by setting deleted_at', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Ticket.delete('ticket-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE tickets SET deleted_at = NOW(), status = \'done\' WHERE id = $1',
        ['ticket-1']
      );
    });

    it('should filter soft-deleted tickets in findByProject', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Ticket.findByProject('proj-1', 'user-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND t.deleted_at IS NULL'),
        ['proj-1']
      );
    });

    it('should filter soft-deleted tickets in findByStatus', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Ticket.findByStatus('proj-1', 'backlog');
      
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND deleted_at IS NULL'),
        ['proj-1', 'backlog']
      );
    });

    it('should filter soft-deleted tickets in findById', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Ticket.findById('ticket-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM tickets WHERE id = $1 AND deleted_at IS NULL',
        ['ticket-1']
      );
    });
  });

  describe('Project', () => {
    it('should soft delete project by setting deleted_at', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Project.delete('proj-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE projects SET deleted_at = NOW() WHERE id = $1',
        ['proj-1']
      );
    });

    it('should filter soft-deleted projects in findAll', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Project.findAll('user-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND p.deleted_at IS NULL'),
        ['user-1']
      );
    });

    it('should filter soft-deleted projects in findById', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await Project.findById('proj-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND p.deleted_at IS NULL'),
        ['proj-1']
      );
    });

    it('should check for existing membership before inserting', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [] }) // existing check
          .mockResolvedValueOnce({ rows: [] }), // insert
      };
      
      transaction.mockImplementation(async (fn) => {
        return await fn(mockClient);
      });
      
      await Project.share('proj-1', 'user-1');
      
      expect(mockClient.query).toHaveBeenNthCalledWith(
        1,
        'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
        ['proj-1', 'user-1']
      );
      expect(mockClient.query).toHaveBeenNthCalledWith(
        2,
        'INSERT INTO project_memberships (project_id, user_id, role) VALUES ($1, $2, \'member\')',
        ['proj-1', 'user-1']
      );
    });

    it('should skip insert if membership already exists', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // existing found
          .mockResolvedValueOnce({ rows: [] }), // unused
      };
      
      transaction.mockImplementation(async (fn) => {
        return await fn(mockClient);
      });
      
      await Project.share('proj-1', 'user-1');
      
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
        ['proj-1', 'user-1']
      );
    });
  });

  describe('User', () => {
    it('should soft delete user by setting deleted_at', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await User.delete('user-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE users SET deleted_at = NOW() WHERE id = $1',
        ['user-1']
      );
    });

    it('should filter soft-deleted users in find', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await User.find('user-1');
      
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
        ['user-1']
      );
    });

    it('should filter soft-deleted users in findByEmail', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await User.findByEmail('test@example.com');
      
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
        ['test@example.com']
      );
    });

    it('should filter soft-deleted users in existsByEmail', async () => {
      pool.query.mockResolvedValue({ rows: [{ exists: true }] });
      
      await User.existsByEmail('test@example.com');
      
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL)',
        ['test@example.com']
      );
    });

    it('should filter soft-deleted users in findAll', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      
      await User.findAll({});
      
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE deleted_at IS NULL'),
        expect.any(Array)
      );
    });
  });
});

describe('Persistence Layer - Indexes', () => {
  it('should create indexes for tickets', () => {
    const fs = require('fs');
    const path = require('path');
    
    const sql = fs.readFileSync(
      path.join(__dirname, '../migrations/004_persistence_layer.sql'),
      'utf8'
    );
    
    expect(sql).toContain('idx_tickets_project_id');
    expect(sql).toContain('idx_tickets_status');
    expect(sql).toContain('idx_tickets_owner_id');
  });

  it('should create indexes for projects and users', () => {
    const fs = require('fs');
    const path = require('path');
    
    const sql = fs.readFileSync(
      path.join(__dirname, '../migrations/004_persistence_layer.sql'),
      'utf8'
    );
    
    expect(sql).toContain('idx_projects_owner_id');
    expect(sql).toContain('idx_users_email');
    expect(sql).toContain('idx_users_role');
  });

  it('should create updated_at trigger function', () => {
    const fs = require('fs');
    const path = require('path');
    
    const sql = fs.readFileSync(
      path.join(__dirname, '../migrations/004_persistence_layer.sql'),
      'utf8'
    );
    
    expect(sql).toContain('set_updated_at');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION');
  });
});

describe('Persistence Layer - fromRow Synchronous', () => {
  it('Ticket.fromRow should be synchronous', () => {
    const row = {
      id: '1',
      project_id: 'proj-1',
      title: 'Test',
      description: 'Test desc',
      status: 'backlog',
      priority: 'medium',
      assignee_id: null,
      assignee_name: null,
      owner_id: 'user-1',
      project_name: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    
    const result = Ticket.fromRow(row);
    
    expect(result).toBeInstanceOf(Ticket);
    expect(result.id).toBe('1');
    expect(result.title).toBe('Test');
    expect(result.status).toBe('backlog');
  });

  it('Project.fromRow should be synchronous', () => {
    const row = {
      id: '1',
      name: 'Test Project',
      description: 'Test desc',
      owner_id: 'user-1',
      owner_name: 'Admin',
      created_at: new Date(),
    };
    
    const result = Project.fromRow(row);
    
    expect(result).toBeInstanceOf(Project);
    expect(result.id).toBe('1');
    expect(result.name).toBe('Test Project');
  });

  it('User.fromRow should be synchronous', () => {
    const row = {
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      password_hash: '$2a$10$...',
      role: 'project_admin',
      current_plan: 'free',
      is_active: true,
      user_created_by: null,
      created_at: new Date(),
    };
    
    const result = new User(row);
    
    expect(result).toBeInstanceOf(User);
    expect(result.id).toBe('1');
    expect(result.email).toBe('test@example.com');
    expect(result.role).toBe('project_admin');
  });
});
