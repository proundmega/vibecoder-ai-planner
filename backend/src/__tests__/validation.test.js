const { validate } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validators/auth');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema } = require('../validators/tickets');
const { createProjectSchema, updateProjectSchema } = require('../validators/projects');
const { createUserSchema, updateUserSchema } = require('../validators/users');

describe('Validation Middleware', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe('validate middleware', () => {
    it('should pass valid data through to next()', () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123' } };
      const middleware = validate(loginSchema);
      middleware(mockReq, mockRes, nextFn);
      expect(nextFn).toHaveBeenCalled();
    });

    it('should return 400 with details on invalid data', () => {
      mockReq = { body: { email: 'invalid', password: '' } };
      const middleware = validate(loginSchema);
      middleware(mockReq, mockRes, nextFn);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      const callArgs = mockRes.json.mock.calls[0][0];
      expect(callArgs.success).toBe(false);
      expect(callArgs.error.code).toBe('VALIDATION_ERROR');
      expect(callArgs.error.message).toBe('Validation failed');
      expect(Array.isArray(callArgs.error.details)).toBe(true);
      expect(callArgs.error.details.length).toBeGreaterThan(0);
    });

    it('should include field-level error details', () => {
      mockReq = { body: { email: 'invalid', password: '' } };
      const middleware = validate(loginSchema);
      middleware(mockReq, mockRes, nextFn);
      const callArgs = mockRes.json.mock.calls[0][0];
      expect(callArgs.error.details).toHaveLength(2);
      expect(callArgs.error.details[0].field).toBe('email');
      expect(callArgs.error.details[1].field).toBe('password');
    });

    it('should allow unknown fields by default', () => {
      mockReq = { body: { email: 'test@example.com', password: 'password123', unknownField: 'value' } };
      const middleware = validate(loginSchema);
      middleware(mockReq, mockRes, nextFn);
      expect(nextFn).toHaveBeenCalled();
    });

    it('should apply default values', () => {
      mockReq = { body: { projectId: '550e8400-e29b-41d4-a716-446655440000', title: 'Test' } };
      const middleware = validate(createTicketSchema);
      middleware(mockReq, mockRes, nextFn);
      expect(nextFn).toHaveBeenCalled();
      expect(mockReq.body.priority).toBe('medium');
    });
  });
});

describe('Auth Schemas', () => {
  describe('registerSchema', () => {
    it('should validate valid registration data', () => {
      const { error } = registerSchema.validate({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
      expect(error).toBeUndefined();
    });

    it('should reject registration with short password', () => {
      const { error } = registerSchema.validate({
        name: 'Test User',
        email: 'test@example.com',
        password: 'short',
      });
      expect(error).toBeDefined();
      expect(error.details[0].message).toContain('at least 6 characters');
    });

    it('should reject registration with invalid email', () => {
      const { error } = registerSchema.validate({
        name: 'Test User',
        email: 'not-an-email',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('should reject registration with empty name', () => {
      const { error } = registerSchema.validate({
        name: '',
        email: 'test@example.com',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('should default role to project_admin', () => {
      const { error, value } = registerSchema.validate({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
      expect(error).toBeUndefined();
      expect(value.role).toBe('project_admin');
    });

    it('should accept valid role values', () => {
      const { error } = registerSchema.validate({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        role: 'project_admin',
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid role values', () => {
      const { error } = registerSchema.validate({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        role: 'invalid_role',
      });
      expect(error).toBeDefined();
    });
  });

  describe('loginSchema', () => {
    it('should validate valid login data', () => {
      const { error } = loginSchema.validate({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(error).toBeUndefined();
    });

    it('should reject login with invalid email', () => {
      const { error } = loginSchema.validate({
        email: 'not-an-email',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('should reject login with empty password', () => {
      const { error } = loginSchema.validate({
        email: 'test@example.com',
        password: '',
      });
      expect(error).toBeDefined();
    });
  });
});

describe('Ticket Schemas', () => {
  describe('createTicketSchema', () => {
    it('should validate valid ticket creation', () => {
      const { error } = createTicketSchema.validate({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Fix login bug',
        description: 'Users cannot login',
        priority: 'high',
      });
      expect(error).toBeUndefined();
    });

    it('should default priority to medium', () => {
      const { error, value } = createTicketSchema.validate({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Fix login bug',
      });
      expect(error).toBeUndefined();
      expect(value.priority).toBe('medium');
    });

    it('should reject ticket without title', () => {
      const { error } = createTicketSchema.validate({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(error).toBeDefined();
    });

    it('should reject ticket without projectId', () => {
      const { error } = createTicketSchema.validate({
        title: 'Fix login bug',
      });
      expect(error).toBeDefined();
    });

    it('should reject invalid projectId format', () => {
      const { error } = createTicketSchema.validate({
        projectId: 'not-a-uuid',
        title: 'Fix login bug',
      });
      expect(error).toBeDefined();
    });

    it('should reject invalid priority values', () => {
      const { error } = createTicketSchema.validate({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Fix login bug',
        priority: 'extreme',
      });
      expect(error).toBeDefined();
    });

    it('should accept all valid priority values', () => {
      const priorities = ['low', 'medium', 'high', 'critical', 'urgent'];
      priorities.forEach(priority => {
        const { error } = createTicketSchema.validate({
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Fix login bug',
          priority,
        });
        expect(error).toBeUndefined();
      });
    });

    it('should allow empty description', () => {
      const { error } = createTicketSchema.validate({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Fix login bug',
        description: '',
      });
      expect(error).toBeUndefined();
    });

    it('should default description to empty string', () => {
      const { error, value } = createTicketSchema.validate({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Fix login bug',
      });
      expect(error).toBeUndefined();
      expect(value.description).toBe('');
    });
  });

  describe('updateTicketSchema', () => {
    it('should validate valid ticket update', () => {
      const { error } = updateTicketSchema.validate({
        title: 'Updated title',
        status: 'in_progress',
      });
      expect(error).toBeUndefined();
    });

    it('should allow partial updates', () => {
      const { error } = updateTicketSchema.validate({
        status: 'review',
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid status values', () => {
      const { error } = updateTicketSchema.validate({
        status: 'invalid',
      });
      expect(error).toBeDefined();
    });

    it('should allow null assigneeId', () => {
      const { error } = updateTicketSchema.validate({
        assigneeId: null,
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid assigneeId format', () => {
      const { error } = updateTicketSchema.validate({
        assigneeId: 'not-a-uuid',
      });
      expect(error).toBeDefined();
    });
  });

  describe('statusTransitionSchema', () => {
    it('should validate valid status', () => {
      const { error } = statusTransitionSchema.validate({ status: 'in_progress' });
      expect(error).toBeUndefined();
    });

    it('should reject missing status', () => {
      const { error } = statusTransitionSchema.validate({});
      expect(error).toBeDefined();
    });

    it('should reject invalid status', () => {
      const { error } = statusTransitionSchema.validate({ status: 'invalid' });
      expect(error).toBeDefined();
    });
  });

  describe('commentSchema', () => {
    it('should validate valid comment', () => {
      const { error } = commentSchema.validate({ content: 'This is a comment' });
      expect(error).toBeUndefined();
    });

    it('should reject empty comment', () => {
      const { error } = commentSchema.validate({ content: '' });
      expect(error).toBeDefined();
    });

    it('should reject missing comment', () => {
      const { error } = commentSchema.validate({});
      expect(error).toBeDefined();
    });
  });
});

describe('Project Schemas', () => {
  describe('createProjectSchema', () => {
    it('should validate valid project creation', () => {
      const { error } = createProjectSchema.validate({
        name: 'My Project',
        description: 'A test project',
      });
      expect(error).toBeUndefined();
    });

    it('should default description to empty string', () => {
      const { error, value } = createProjectSchema.validate({
        name: 'My Project',
      });
      expect(error).toBeUndefined();
      expect(value.description).toBe('');
    });

    it('should reject project without name', () => {
      const { error } = createProjectSchema.validate({});
      expect(error).toBeDefined();
    });

    it('should reject empty project name', () => {
      const { error } = createProjectSchema.validate({ name: '' });
      expect(error).toBeDefined();
    });

    it('should reject project name over 200 characters', () => {
      const { error } = createProjectSchema.validate({ name: 'a'.repeat(201) });
      expect(error).toBeDefined();
    });
  });

  describe('updateProjectSchema', () => {
    it('should validate valid project update', () => {
      const { error } = updateProjectSchema.validate({
        name: 'Updated Project',
        description: 'Updated description',
      });
      expect(error).toBeUndefined();
    });

    it('should reject update without name', () => {
      const { error } = updateProjectSchema.validate({ description: 'No name' });
      expect(error).toBeDefined();
    });
  });
});

describe('User Schemas', () => {
  describe('createUserSchema', () => {
    it('should validate valid user creation', () => {
      const { error } = createUserSchema.validate({
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
        role: 'user',
      });
      expect(error).toBeUndefined();
    });

    it('should reject user creation without role', () => {
      const { error } = createUserSchema.validate({
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
      });
      expect(error).toBeDefined();
    });

    it('should reject invalid role values', () => {
      const { error } = createUserSchema.validate({
        name: 'New User',
        email: 'new@example.com',
        password: 'password123',
        role: 'super_admin',
      });
      expect(error).toBeDefined();
    });

    it('should accept valid role values', () => {
      const roles = ['user', 'member', 'project_admin'];
      roles.forEach(role => {
        const { error } = createUserSchema.validate({
          name: 'New User',
          email: 'new@example.com',
          password: 'password123',
          role,
        });
        expect(error).toBeUndefined();
      });
    });
  });

  describe('updateUserSchema', () => {
    it('should validate valid user update', () => {
      const { error } = updateUserSchema.validate({
        name: 'Updated Name',
      });
      expect(error).toBeUndefined();
    });

    it('should allow partial updates', () => {
      const { error } = updateUserSchema.validate({
        email: 'updated@example.com',
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid email format', () => {
      const { error } = updateUserSchema.validate({
        email: 'not-an-email',
      });
      expect(error).toBeDefined();
    });

    it('should reject invalid role values', () => {
      const { error } = updateUserSchema.validate({
        role: 'super_admin',
      });
      expect(error).toBeDefined();
    });
  });
});
