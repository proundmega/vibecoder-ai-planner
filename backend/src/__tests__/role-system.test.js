const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock the db module
jest.mock('../db', () => {
  const mockPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn(),
    end: jest.fn(),
  };
  return { pool: mockPool, connect: jest.fn().mockResolvedValue(true) };
});

const { pool } = require('../db');

// User model methods (used by UserService tests via pool.query mocks)
const mockUserFind = jest.fn();
const mockUserFindByEmail = jest.fn();
const mockUserExistsByEmail = jest.fn();
const mockUserFindAll = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserToggleActive = jest.fn();
const mockUserDelete = jest.fn();
const mockUserFindByRole = jest.fn();
const mockUserCreate = jest.fn();

// Mock Ticket model
const mockTicketFindById = jest.fn();
const mockTicketDelete = jest.fn();
const mockTicketUpdateStatus = jest.fn();
const mockTicketFind = jest.fn();
const mockTicketFindAll = jest.fn();
const mockTicketUpdate = jest.fn();
const mockTicketCreate = jest.fn();

jest.mock('../models/ticket', () => {
  const mockTicket = jest.fn().mockImplementation((data) => data);
  mockTicket.findById = mockTicketFindById;
  mockTicket.delete = mockTicketDelete;
  mockTicket.updateStatus = mockTicketUpdateStatus;
  mockTicket.find = mockTicketFind;
  mockTicket.findAll = mockTicketFindAll;
  mockTicket.update = mockTicketUpdate;
  mockTicket.create = mockTicketCreate;
  return mockTicket;
});

// Approval model methods (used by ApprovalService tests via pool.query mocks)
const mockApprovalFindById = jest.fn();
const mockApprovalApprove = jest.fn();
const mockApprovalReject = jest.fn();
const mockApprovalGetByTicketAndRequester = jest.fn();

// Mock PermissionService
const mockPermissionHasPermission = jest.fn();
jest.mock('../services/PermissionService', () => ({
  hasPermission: mockPermissionHasPermission,
  hasAnyPermission: jest.fn(),
  hasAllPermissions: jest.fn(),
  clearCache: jest.fn(),
}));

process.env.JWT_SECRET = 'test-secret-key-at-least-32-chars';
process.env.TOKEN_EXPIRY_HOURS = '24';

// Helper to create mock user objects matching DB row format with proper User properties
function makeUser(overrides = {}) {
  const data = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    password_hash: 'hashed',
    role: 'project_admin',
    current_plan: 'free',
    is_active: true,
    user_created_by: null,
    created_at: new Date(),
    ...overrides,
  };
  // Return a User instance with proper properties
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    passwordHash: data.password_hash,
    role: data.role || 'project_admin',
    currentPlan: data.current_plan || 'free',
    isActive: data.is_active !== false,
    userCreatedBy: data.user_created_by || null,
    createdAt: data.created_at,
  };
}

// Helper to create approval row objects
function makeApproval(overrides = {}) {
  return {
    id: 1,
    ticket_id: 1,
    requested_by: 1,
    status: 'pending',
    ...overrides,
  };
}

describe('UserService', () => {
  let UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    UserService = require('../services/UserService');
  });

  describe('register()', () => {
    it('should register a new user with default role', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: false }] });
        }
        if (query.includes('INSERT INTO users')) {
          return Promise.resolve({
            rows: [{ id: 1, name: 'Test', email: 'test@example.com', role: 'user', user_created_by: null, is_active: true, current_plan: 'free' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const user = await UserService.register('Test', 'test@example.com', 'password');

      expect(user.name).toBe('Test');
      expect(user.role).toBe('user');
      expect(bcrypt.hash).toHaveBeenCalledWith('password', 10);
    });

    it('should throw if email already registered', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.register('Test', 'test@example.com', 'password')
      ).rejects.toThrow('Email already registered');
    });

    it('should register with custom role and userCreatedBy', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: false }] });
        }
        if (query.includes('INSERT INTO users')) {
          return Promise.resolve({
            rows: [{ id: 1, name: 'Test', email: 'test@example.com', role: 'member', user_created_by: 1, is_active: true, current_plan: 'free' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const user = await UserService.register('Test', 'test@example.com', 'password', 'member', 1);

      expect(user.role).toBe('member');
      expect(user.userCreatedBy).toBe(1);
    });
  });

  describe('authenticate()', () => {
    it('should authenticate valid user', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE email')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Test', email: 'test@example.com', role: 'project_admin', is_active: true, password_hash: 'hashed', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      bcrypt.compare.mockResolvedValue(true);

      const result = await UserService.authenticate('test@example.com', 'password');

      expect(result.email).toBe('test@example.com');
      expect(result.role).toBe('project_admin');
      expect(result.isActive).toBe(true);
    });

    it('should throw if user not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        UserService.authenticate('missing@example.com', 'password')
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw if account is deactivated', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test', email: 'test@example.com', role: 'project_admin', is_active: false, password_hash: 'hashed', current_plan: 'free' }] });

      await expect(
        UserService.authenticate('test@example.com', 'password')
      ).rejects.toThrow('Account deactivated. Contact support.');
    });

    it('should throw if password is invalid', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test', email: 'test@example.com', role: 'project_admin', is_active: true, password_hash: 'hashed', current_plan: 'free' }] });
      bcrypt.compare.mockResolvedValue(false);

      await expect(
        UserService.authenticate('test@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('createUser()', () => {
    it('should create a user with role and createdBy', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: false }] });
        }
        if (query.includes('INSERT INTO users')) {
          return Promise.resolve({
            rows: [{ id: 1, name: 'Member', email: 'member@example.com', role: 'member', user_created_by: 1, is_active: true, current_plan: 'free' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const user = await UserService.createUser('Member', 'member@example.com', 'password', 'member', 1);

      expect(user.name).toBe('Member');
      expect(user.role).toBe('member');
      expect(user.userCreatedBy).toBe(1);
    });

    it('should throw if email already exists', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT EXISTS')) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.createUser('Test', 'existing@example.com', 'password', 'member', 1)
      ).rejects.toThrow('Email already registered');
    });
  });

  describe('listUsers()', () => {
    it('should scope results by project_admin userId', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await UserService.listUsers(1, 'project_admin', {});

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_created_by = $1'),
        expect.arrayContaining([1, 1])
      );
    });

    it('should scope results by member userId', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await UserService.listUsers(2, 'member', {});

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_created_by = $1'),
        expect.arrayContaining([2])
      );
    });

    it('should filter by role when provided', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await UserService.listUsers(1, 'project_admin', { role: 'member' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('role = $'),
        expect.any(Array)
      );
    });

    it('should filter by search term', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await UserService.listUsers(1, 'project_admin', { search: 'test' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.any(Array)
      );
    });
  });

  describe('listAllUsers()', () => {
    it('should return all users without scoping', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await UserService.listAllUsers({});

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM users'),
        expect.any(Array)
      );
    });

    it('should filter by is_active', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await UserService.listAllUsers({ is_active: 'true' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active = $'),
        expect.any(Array)
      );
    });
  });

  describe('updateUser()', () => {
    it('should update user name', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('UPDATE users SET')) {
          return Promise.resolve({ rows: [{ id: 2, name: 'Updated', is_active: true }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await UserService.updateUser(2, 1, { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });

    it('should throw if updating own account', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.updateUser(1, 1, { name: 'Updated' })
      ).rejects.toThrow('Cannot update your own account');
    });

    it('should throw if user not found', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id') && query.includes('adminId')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.updateUser(999, 1, { name: 'Updated' })
      ).rejects.toThrow('User not found');
    });

    it('should update is_active', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('UPDATE users SET')) {
          return Promise.resolve({ rows: [{ id: 2, name: 'Test', is_active: false }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await UserService.updateUser(2, 1, { is_active: false });

      expect(result.isActive).toBe(false);
    });
  });

  describe('toggleUserActive()', () => {
    it('should toggle user active status', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('UPDATE users SET is_active')) {
          return Promise.resolve({ rows: [{ id: 2, is_active: false }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await UserService.toggleUserActive(2, 1);

      expect(result.isActive).toBe(false);
    });

    it('should throw if toggling own account', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.toggleUserActive(1, 1)
      ).rejects.toThrow('Cannot toggle your own account');
    });

    it('should throw if user not found', async () => {
      let callCount = 0;
      pool.query.mockImplementation((query) => {
        callCount++;
        if (query.includes('SELECT * FROM users WHERE id') && callCount === 1) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.toggleUserActive(999, 1)
      ).rejects.toThrow('User not found');
    });
  });

  describe('deleteUser()', () => {
    it('should delete user', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await UserService.deleteUser(2, 1);
    });

    it('should throw if deleting own account', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.deleteUser(1, 1)
      ).rejects.toThrow('Cannot delete your own account');
    });

    it('should throw if user not found', async () => {
      let callCount = 0;
      pool.query.mockImplementation((query) => {
        callCount++;
        if (query.includes('SELECT * FROM users WHERE id') && callCount === 1) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        UserService.deleteUser(999, 1)
      ).rejects.toThrow('User not found');
    });
  });
});

describe('AuthService', () => {
  let AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    AuthService = require('../auth');
  });

  describe('register()', () => {
    it('should throw for super_admin role', async () => {
      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'super_admin')
      ).rejects.toThrow('Super admin accounts must be created manually');
    });

    it('should allow project_admin to create member', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', email: 'admin@example.com', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const mockUser = makeUser({
        id: 2, email: 'member@example.com', name: 'Member',
        role: 'member', current_plan: 'free', is_active: true,
      });
      const UserService = require('../services/UserService');
      UserService.register = jest.fn().mockResolvedValue(mockUser);
      jwt.sign.mockReturnValue('mock-token');

      const result = await AuthService.register('Member', 'member@example.com', 'password', 'member', 1);

      expect(result.user.role).toBe('member');
    });

    it('should allow project_admin to create user', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', email: 'admin@example.com', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const mockUser = makeUser({
        id: 2, email: 'user@example.com', name: 'User',
        role: 'user', current_plan: 'free', is_active: true,
      });
      const UserService = require('../services/UserService');
      UserService.register = jest.fn().mockResolvedValue(mockUser);
      jwt.sign.mockReturnValue('mock-token');

      const result = await AuthService.register('User', 'user@example.com', 'password', 'user', 1);

      expect(result.user.role).toBe('user');
    });

    it('should throw if project_admin tries to create super_admin', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', email: 'admin@example.com', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'super_admin', 1)
      ).rejects.toThrow('Super admin accounts must be created manually');
    });

    it('should throw if project_admin tries to create project_admin', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Admin', email: 'admin@example.com', role: 'project_admin', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'project_admin', 1)
      ).rejects.toThrow('Project admins can only create member or user accounts');
    });

    it('should allow member to create user', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Member', email: 'member@example.com', role: 'member', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const mockUser = makeUser({
        id: 2, email: 'user@example.com', name: 'User',
        role: 'user', current_plan: 'free', is_active: true,
      });
      const UserService = require('../services/UserService');
      UserService.register = jest.fn().mockResolvedValue(mockUser);
      jwt.sign.mockReturnValue('mock-token');

      const result = await AuthService.register('User', 'user@example.com', 'password', 'user', 1);

      expect(result.user.role).toBe('user');
    });

    it('should throw if member tries to create member', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Member', email: 'member@example.com', role: 'member', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'member', 1)
      ).rejects.toThrow('Members can only create user accounts');
    });

    it('should throw if member tries to create project_admin', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'Member', email: 'member@example.com', role: 'member', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'project_admin', 1)
      ).rejects.toThrow('Members can only create user accounts');
    });

    it('should throw if user tries to create any account', async () => {
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'User', email: 'user@example.com', role: 'user', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'user', 1)
      ).rejects.toThrow('AI agents cannot create user accounts');
    });

    it('should throw if creator not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        AuthService.register('Test', 'test@example.com', 'password', 'member', 999)
      ).rejects.toThrow('Creator not found');
    });

    it('should allow self-registration without userCreatedBy', async () => {
      const mockUser = makeUser({
        id: 1, email: 'test@example.com', name: 'Test',
        role: 'project_admin', current_plan: 'free', is_active: true,
      });
      const UserService = require('../services/UserService');
      UserService.register = jest.fn().mockResolvedValue(mockUser);
      jwt.sign.mockReturnValue('mock-token');

      const result = await AuthService.register('Test', 'test@example.com', 'password');

      expect(result.user.role).toBe('project_admin');
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});

describe('ApprovalService', () => {
  let ApprovalService;

  beforeEach(() => {
    jest.clearAllMocks();
    ApprovalService = require('../services/ApprovalService');
  });

  describe('create()', () => {
    it('should create approval request for ticket in review', async () => {
      mockTicketFindById.mockResolvedValue({ status: 'review', id: 1 });
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'User', email: 'user@example.com', role: 'user', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('SELECT * FROM approval_requests') && query.includes('ticket_id') && query.includes('requested_by')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });
      const ApprovalRequest = require('../models/approval');
      ApprovalRequest.create = jest.fn().mockResolvedValue({ id: 1, ticket_id: 1, status: 'pending' });

      const result = await ApprovalService.create(1, 1);

      expect(result.ticket_id).toBe(1);
      expect(result.status).toBe('pending');
    });

    it('should throw if ticket not found', async () => {
      mockTicketFindById.mockResolvedValue(null);

      await expect(ApprovalService.create(999, 1)).rejects.toThrow('Ticket not found');
    });

    it('should throw if user not found', async () => {
      mockTicketFindById.mockResolvedValue({ status: 'review', id: 1 });
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ApprovalService.create(1, 999)).rejects.toThrow('User not found');
    });

    it('should throw if ticket is not in review status', async () => {
      mockTicketFindById.mockResolvedValue({ status: 'in_progress', id: 1 });
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'User', email: 'user@example.com', role: 'user', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(ApprovalService.create(1, 1)).rejects.toThrow(
        'Can only request approval for tickets in review status'
      );
    });

    it('should throw if approval already pending', async () => {
      mockTicketFindById.mockResolvedValue({ status: 'review', id: 1 });
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, name: 'User', email: 'user@example.com', role: 'user', is_active: true, password_hash: 'hash', current_plan: 'free' }] });
        }
        if (query.includes('SELECT * FROM approval_requests') && query.includes('ticket_id') && query.includes('requested_by')) {
          return Promise.resolve({ rows: [{ id: 1, ticket_id: 1, status: 'pending' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(ApprovalService.create(1, 1)).rejects.toThrow(
        'Approval request already pending for this ticket'
      );
    });
  });

  describe('approve()', () => {
    it('should approve request and update ticket status', async () => {
      mockPermissionHasPermission.mockResolvedValue(true);
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM approval_requests WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, role: 'project_admin' }] });
        }
        if (query.includes('UPDATE approval_requests')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'approved', approved_by: 1 }] });
        }
        if (query.includes('UPDATE tickets SET status')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await ApprovalService.approve(1, 1);

      expect(result.status).toBe('approved');
      expect(mockTicketUpdateStatus).toHaveBeenCalledWith(1, 'done', 1);
    });

    it('should throw if approval not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ApprovalService.approve(999, 1)).rejects.toThrow('Approval request not found');
    });

    it('should throw if approval is not pending', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'approved', ticket_id: 1 }] });

      await expect(ApprovalService.approve(1, 1)).rejects.toThrow('Approval request is not pending');
    });

    it('should throw if approver not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(ApprovalService.approve(1, 999)).rejects.toThrow('Approver not found');
    });

    it('should throw if approver has user role', async () => {
      mockPermissionHasPermission.mockResolvedValue(false);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, role: 'user' }] });

      await expect(ApprovalService.approve(1, 1)).rejects.toThrow(
        'Only project admins, members, or super admins can approve requests'
      );
    });

    it('should allow member to approve', async () => {
      mockPermissionHasPermission.mockResolvedValue(true);
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM approval_requests WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, role: 'member' }] });
        }
        if (query.includes('UPDATE approval_requests')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'approved', approved_by: 1 }] });
        }
        if (query.includes('UPDATE tickets SET status')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await ApprovalService.approve(1, 1);

      expect(result.status).toBe('approved');
    });

    it('should allow super_admin to approve', async () => {
      mockPermissionHasPermission.mockResolvedValue(true);
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM approval_requests WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, role: 'super_admin' }] });
        }
        if (query.includes('UPDATE approval_requests')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'approved', approved_by: 1 }] });
        }
        if (query.includes('UPDATE tickets SET status')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await ApprovalService.approve(1, 1);

      expect(result.status).toBe('approved');
    });
  });

  describe('reject()', () => {
    it('should reject approval request', async () => {
      mockPermissionHasPermission.mockResolvedValue(true);
      pool.query.mockImplementation((query) => {
        if (query.includes('SELECT * FROM approval_requests WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] });
        }
        if (query.includes('SELECT * FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 1, role: 'project_admin' }] });
        }
        if (query.includes('UPDATE approval_requests')) {
          return Promise.resolve({ rows: [{ id: 1, status: 'rejected', approved_by: 1 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await ApprovalService.reject(1, 1);

      expect(result.status).toBe('rejected');
    });

    it('should throw if approval not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ApprovalService.reject(999, 1)).rejects.toThrow('Approval request not found');
    });

    it('should throw if approval is not pending', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'approved', ticket_id: 1 }] });

      await expect(ApprovalService.reject(1, 1)).rejects.toThrow('Approval request is not pending');
    });

    it('should throw if approver has user role', async () => {
      mockPermissionHasPermission.mockResolvedValue(false);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending', ticket_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, role: 'user' }] });

      await expect(ApprovalService.reject(1, 1)).rejects.toThrow(
        'Only project admins, members, or super admins can reject requests'
      );
    });
  });

  describe('getPendingByRequester()', () => {
    it('should return pending approvals for user', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_id: 1, status: 'pending', ticket_title: 'Test', ticket_status: 'review' }],
      });

      const result = await ApprovalService.getPendingByRequester(1);

      expect(result.length).toBe(1);
    });
  });

  describe('getByTicketId()', () => {
    it('should return approvals for ticket', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_id: 1, status: 'pending', requester_name: 'Test User' }],
      });

      const result = await ApprovalService.getByTicketId(1);

      expect(result.length).toBe(1);
    });
  });
});

describe('TicketService.delete()', () => {
  let TicketService;

  beforeEach(() => {
    jest.clearAllMocks();
    TicketService = require('../services/TicketService');
  });

  it('should delete ticket when user is the owner', async () => {
    mockTicketFindById.mockResolvedValue({ id: 1, ownerId: 1 });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, role: 'user' }] });
    mockTicketDelete.mockResolvedValue(undefined);

    await TicketService.delete(1, 1);

    expect(mockTicketDelete).toHaveBeenCalledWith(1);
  });

  it('should delete ticket when user is project_admin', async () => {
    mockTicketFindById.mockResolvedValue({ id: 1, ownerId: 2 });
    mockPermissionHasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, role: 'project_admin' }] });
    mockTicketDelete.mockResolvedValue(undefined);

    await TicketService.delete(1, 1);

    expect(mockTicketDelete).toHaveBeenCalledWith(1);
  });

  it('should delete ticket when user is member', async () => {
    mockTicketFindById.mockResolvedValue({ id: 1, ownerId: 2 });
    mockPermissionHasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, role: 'member' }] });
    mockTicketDelete.mockResolvedValue(undefined);

    await TicketService.delete(1, 1);

    expect(mockTicketDelete).toHaveBeenCalledWith(1);
  });

  it('should delete ticket when user is super_admin', async () => {
    mockTicketFindById.mockResolvedValue({ id: 1, ownerId: 2 });
    mockPermissionHasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, role: 'super_admin' }] });
    mockTicketDelete.mockResolvedValue(undefined);

    await TicketService.delete(1, 1);

    expect(mockTicketDelete).toHaveBeenCalledWith(1);
  });

  it('should throw if ticket not found', async () => {
    mockTicketFindById.mockResolvedValue(null);

    await expect(TicketService.delete(999, 1)).rejects.toThrow('Ticket not found');
  });

  it('should throw forbidden for user role deleting others ticket', async () => {
    mockTicketFindById.mockResolvedValue({ id: 1, ownerId: 2 });
    mockPermissionHasPermission.mockResolvedValue(false);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, role: 'user' }] });

    await expect(TicketService.delete(1, 1)).rejects.toThrow('Forbidden');
  });

  it('should throw forbidden for non-owner non-admin', async () => {
    mockTicketFindById.mockResolvedValue({ id: 1, ownerId: 2 });
    mockPermissionHasPermission.mockResolvedValue(false);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, role: 'user' }] });

    await expect(TicketService.delete(1, 3)).rejects.toThrow('Forbidden');
  });
});

describe('ApprovalRequest model', () => {
  describe('create()', () => {
    it('should insert approval request', async () => {
      jest.clearAllMocks();
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_id: 1, requested_by: 1, status: 'pending' }],
      });

      const result = await ApprovalRequest.create(1, 1);

      expect(result.ticket_id).toBe(1);
      expect(result.status).toBe('pending');
    });
  });

  describe('findById()', () => {
    it('should return approval by id', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_id: 1, status: 'pending' }],
      });

      const result = await ApprovalRequest.findById(1);

      expect(result.id).toBe(1);
    });

    it('should return null if not found', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({ rows: [] });

      const result = await ApprovalRequest.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('approve()', () => {
    it('should update approval status to approved', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, status: 'approved', approved_by: 1 }],
      });

      const result = await ApprovalRequest.approve(1, 1);

      expect(result.status).toBe('approved');
      expect(result.approved_by).toBe(1);
    });

    it('should return null if approval not found', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({ rows: [] });

      const result = await ApprovalRequest.approve(999, 1);

      expect(result).toBeNull();
    });
  });

  describe('reject()', () => {
    it('should update approval status to rejected', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, status: 'rejected', approved_by: 1 }],
      });

      const result = await ApprovalRequest.reject(1, 1);

      expect(result.status).toBe('rejected');
    });

    it('should return null if approval not found', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({ rows: [] });

      const result = await ApprovalRequest.reject(999, 1);

      expect(result).toBeNull();
    });
  });

  describe('getByTicketAndRequester()', () => {
    it('should find pending approval for ticket and requester', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_id: 1, requested_by: 1, status: 'pending' }],
      });

      const result = await ApprovalRequest.getByTicketAndRequester(1, 1);

      expect(result.ticket_id).toBe(1);
      expect(result.requested_by).toBe(1);
    });

    it('should return null if no pending approval', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({ rows: [] });

      const result = await ApprovalRequest.getByTicketAndRequester(1, 1);

      expect(result).toBeNull();
    });
  });

  describe('getPendingByRequester()', () => {
    it('should return all pending approvals for user', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, ticket_id: 1, status: 'pending' },
          { id: 2, ticket_id: 2, status: 'pending' },
        ],
      });

      const result = await ApprovalRequest.getPendingByRequester(1);

      expect(result.length).toBe(2);
    });
  });

  describe('getByTicketId()', () => {
    it('should return all approvals for ticket', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, ticket_id: 1, status: 'pending' },
          { id: 2, ticket_id: 1, status: 'approved' },
        ],
      });

      const result = await ApprovalRequest.getByTicketId(1);

      expect(result.length).toBe(2);
    });
  });

  describe('findByTicket()', () => {
    it('should find latest pending approval for ticket', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_id: 1, status: 'pending' }],
      });

      const result = await ApprovalRequest.findByTicket(1);

      expect(result.ticket_id).toBe(1);
    });

    it('should return null if no pending approval', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({ rows: [] });

      const result = await ApprovalRequest.findByTicket(1);

      expect(result).toBeNull();
    });
  });

  describe('listByUser()', () => {
    it('should return pending approvals for approver', async () => {
      const ApprovalRequest = require('../models/approval');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, ticket_title: 'Test Ticket', requester_name: 'AI Agent' }],
      });

      const result = await ApprovalRequest.listByUser(1);

      expect(result.length).toBe(1);
    });
  });
});

describe('User model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should set isActive from data', () => {
      const UserClass = require('../models/user');
      const user = new UserClass({
        id: 1, name: 'Test', email: 'test@example.com',
        password_hash: 'hash', role: 'project_admin',
        is_active: true, user_created_by: null,
      });

      expect(user.isActive).toBe(true);
    });

    it('should default isActive to true when undefined', () => {
      const UserClass = require('../models/user');
      const user = new UserClass({
        id: 1, name: 'Test', email: 'test@example.com',
        password_hash: 'hash', role: 'project_admin',
      });

      expect(user.isActive).toBe(true);
    });

    it('should set userCreatedBy from data', () => {
      const UserClass = require('../models/user');
      const user = new UserClass({
        id: 1, name: 'Test', email: 'test@example.com',
        password_hash: 'hash', role: 'project_admin',
        user_created_by: 5,
      });

      expect(user.userCreatedBy).toBe(5);
    });

    it('should default userCreatedBy to null', () => {
      const UserClass = require('../models/user');
      const user = new UserClass({
        id: 1, name: 'Test', email: 'test@example.com',
        password_hash: 'hash', role: 'project_admin',
      });

      expect(user.userCreatedBy).toBeNull();
    });

    it('should default role to project_admin', () => {
      const UserClass = require('../models/user');
      const user = new UserClass({
        id: 1, name: 'Test', email: 'test@example.com',
        password_hash: 'hash',
      });

      expect(user.role).toBe('project_admin');
    });
  });

  describe('existsByEmail()', () => {
    it('should return true if email exists', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({ rows: [{ exists: true }] });

      const result = await UserClass.existsByEmail('test@example.com');

      expect(result).toBe(true);
    });

    it('should return false if email does not exist', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValueOnce({ rows: [{ exists: false }] });

      const result = await UserClass.existsByEmail('missing@example.com');

      expect(result).toBe(false);
    });
  });

  describe('findAll()', () => {
    it('should return paginated users', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, name: 'User1', email: 'user1@example.com', role: 'project_admin' },
          { id: 2, name: 'User2', email: 'user2@example.com', role: 'member' },
        ],
      });

      const users = await UserClass.findAll({ page: 1, perPage: 20 });

      expect(users.length).toBe(2);
      expect(users[0].name).toBe('User1');
    });

    it('should filter by role', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({ rows: [] });

      await UserClass.findAll({ role: 'project_admin' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('role = $'),
        expect.any(Array)
      );
    });

    it('should filter by search', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({ rows: [] });

      await UserClass.findAll({ search: 'test' });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.any(Array)
      );
    });
  });

  describe('update()', () => {
    it('should update name and is_active', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, name: 'Updated', is_active: false }],
      });

      const result = await UserClass.update(1, { name: 'Updated', is_active: false });

      expect(result.name).toBe('Updated');
      expect(result.isActive).toBe(false);
    });

    it('should return null if no fields to update', async () => {
      const UserClass = require('../models/user');
      const result = await UserClass.update(1, {});

      expect(result).toBeNull();
    });
  });

  describe('toggleActive()', () => {
    it('should toggle is_active', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({
        rows: [{ id: 1, is_active: false }],
      });

      const result = await UserClass.toggleActive(1);

      expect(result.isActive).toBe(false);
    });

    it('should return null if user not found', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({ rows: [] });

      const result = await UserClass.toggleActive(999);

      expect(result).toBeNull();
    });
  });

  describe('delete()', () => {
    it('should soft delete user', async () => {
      const UserClass = require('../models/user');
      await UserClass.delete(1);

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE users SET deleted_at = NOW() WHERE id = $1',
        [1]
      );
    });
  });

  describe('findByRole()', () => {
    it('should return users with specified role', async () => {
      const UserClass = require('../models/user');
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, name: 'Admin1', email: 'admin1@example.com', role: 'project_admin' },
          { id: 2, name: 'Admin2', email: 'admin2@example.com', role: 'project_admin' },
        ],
      });

      const users = await UserClass.findByRole('project_admin');

      expect(users.length).toBe(2);
      expect(users[0].role).toBe('project_admin');
    });
  });
});
