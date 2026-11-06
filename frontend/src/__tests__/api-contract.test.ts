import { describe, it, expect } from 'vitest';
import { validateUser, validateProject, validateTicket, validateAgent, validateApiResponse, validateApiResponseStrict, validateSchema, validateAndExtract } from '../api/validator';

describe('API Response Contract Tests', () => {
  describe('validateApiResponse', () => {
    it('should accept valid API response', () => {
      const validResponse = {
        success: true,
        data: { id: '123', name: 'Test' },
      };
      const errors = validateApiResponse(validResponse);
      expect(errors).toHaveLength(0);
    });

    it('should reject response without success field', () => {
      const invalidResponse = {
        data: { id: '123', name: 'Test' },
      };
      const errors = validateApiResponse(invalidResponse);
      expect(errors).toContain('root.success: required field missing');
    });

    it('should reject response without data field', () => {
      const invalidResponse = {
        success: true,
      };
      const errors = validateApiResponse(invalidResponse);
      expect(errors).toContain('root.data: required field missing');
    });
  });

  describe('validateUser', () => {
    it('should accept valid user object', () => {
      const validUser = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'project_admin',
        isActive: true,
      };
      const errors = validateUser(validUser);
      expect(errors).toHaveLength(0);
    });

    it('should reject user without required fields', () => {
      const invalidUser = {
        name: 'John Doe',
        email: 'john@example.com',
      };
      const errors = validateUser(invalidUser);
      expect(errors).toContain('root.id: required field missing');
      expect(errors).toContain('root.role: required field missing');
      expect(errors).toContain('root.isActive: required field missing');
    });

    it('should reject user with invalid role', () => {
      const invalidUser = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'invalid_role',
        isActive: true,
      };
      const errors = validateUser(invalidUser);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should accept a null name because users.name is nullable', () => {
      const user = {
        id: '1',
        name: null,
        email: 'john@example.com',
        role: 'user',
        isActive: true,
      };
      expect(validateUser(user)).toHaveLength(0);
    });

    it('should detect snake_case vs camelCase mismatch', () => {
      const snakeCaseUser = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'project_admin',
        is_active: false, // This should be isActive
      };
      const errors = validateUser(snakeCaseUser);
      expect(errors).toContain('root.isActive: required field missing');
    });
  });

  describe('validateProject', () => {
    it('should accept valid project object', () => {
      const validProject = {
        id: '1',
        name: 'Test Project',
        ownerId: '2',
      };
      const errors = validateProject(validProject);
      expect(errors).toHaveLength(0);
    });

    it('should reject project without required fields', () => {
      const invalidProject = {
        name: 'Test Project',
      };
      const errors = validateProject(invalidProject);
      expect(errors).toContain('root.id: required field missing');
      expect(errors).toContain('root.ownerId: required field missing');
    });

    it('should reject the legacy snake_case owner_id (bp-124 O5)', () => {
      const snakeCaseProject = {
        id: '1',
        name: 'Test Project',
        owner_id: '2',
      };
      expect(validateProject(snakeCaseProject)).toContain('root.ownerId: required field missing');
    });

    it('should accept null description/ownerName because those columns are nullable', () => {
      const project = {
        id: '1',
        name: 'Test Project',
        description: null,
        ownerId: '2',
        ownerName: null,
      };
      expect(validateProject(project)).toHaveLength(0);
    });
  });

  describe('validateTicket', () => {
    it('should accept valid ticket object', () => {
      const validTicket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
      };
      const errors = validateTicket(validTicket);
      expect(errors).toHaveLength(0);
    });

    it('should accept the critical priority', () => {
      const validTicket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        priority: 'critical',
        ownerId: '2',
        projectId: '3',
      };
      expect(validateTicket(validTicket)).toHaveLength(0);
    });

    it('should reject ticket with invalid status', () => {
      const invalidTicket = {
        id: '1',
        title: 'Test Ticket',
        status: 'invalid_status',
        ownerId: '2',
        projectId: '3',
      };
      const errors = validateTicket(invalidTicket);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject an unknown priority', () => {
      const invalidTicket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        priority: 'blocker',
        ownerId: '2',
        projectId: '3',
      };
      expect(validateTicket(invalidTicket).length).toBeGreaterThan(0);
    });

    it('should accept a null description because tickets.description is nullable', () => {
      const ticket = {
        id: '1',
        title: 'Test Ticket',
        description: null,
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
      };
      expect(validateTicket(ticket)).toHaveLength(0);
    });

    it('should accept milestone fields with string dependsOn (bp-124 O1)', () => {
      const ticket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
        milestoneId: '123e4567-e89b-12d3-a456-426614174000',
        estimate: 3,
        dependsOn: ['46', '47'],
      };
      expect(validateTicket(ticket)).toHaveLength(0);
    });

    it('should reject numeric dependsOn because pg returns BIGINT[] as strings', () => {
      const ticket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
        dependsOn: [46],
      };
      expect(validateTicket(ticket)).toContain('root.dependsOn[0]: expected string, got number');
    });

    it('should reject a numeric BIGSERIAL id', () => {
      const ticket = {
        id: 60,
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
      };
      expect(validateTicket(ticket)).toContain('root.id: expected string, got number');
    });

    it('should reject a non-numeric BIGSERIAL id because int64 format is enforced', () => {
      const ticket = {
        id: 'abc',
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
      };
      expect(validateTicket(ticket)).toContain('root.id: does not match int64');
    });

    it('should reject an invalid milestone uuid', () => {
      const ticket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
        milestoneId: 'not-a-uuid',
      };
      expect(validateTicket(ticket)).toContain('root.milestoneId: does not match uuid');
    });

    it('should accept null or numeric-string assignee fields', () => {
      const ticket = {
        id: '1',
        title: 'Test Ticket',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
        assigneeId: null,
        assigneeName: null,
      };
      expect(validateTicket(ticket)).toHaveLength(0);

      const assigned = { ...ticket, assigneeId: '46', assigneeName: 'Ada' };
      expect(validateTicket(assigned)).toHaveLength(0);
    });
  });

  describe('validateAgent', () => {
    it('should accept valid agent object with string BIGSERIAL ids', () => {
      const validAgent = {
        id: '1',
        name: 'Test Agent',
        owner_id: '2',
      };
      const errors = validateAgent(validAgent);
      expect(errors).toHaveLength(0);
    });

    it('should reject agent without required fields', () => {
      const invalidAgent = {
        name: 'Test Agent',
      };
      const errors = validateAgent(invalidAgent);
      expect(errors).toContain('root.id: required field missing');
      expect(errors).toContain('root.owner_id: required field missing');
    });
  });

  describe('validateApiResponseStrict', () => {
    it('should not throw for valid API response', () => {
      const validResponse = {
        success: true,
        data: { id: '123', name: 'Test' },
      };
      expect(() => validateApiResponseStrict(validResponse)).not.toThrow();
    });

    it('should throw for response without success field', () => {
      const invalidResponse = {
        data: { id: '123', name: 'Test' },
      };
      expect(() => validateApiResponseStrict(invalidResponse)).toThrow('root.success: required field missing');
    });

    it('should throw for response without data field', () => {
      const invalidResponse = {
        success: true,
      };
      expect(() => validateApiResponseStrict(invalidResponse)).toThrow('root.data: required field missing');
    });

    it('should throw for non-object response', () => {
      expect(() => validateApiResponseStrict('string')).toThrow('root: response must be an object');
      expect(() => validateApiResponseStrict(null)).toThrow('root: response must be an object');
      expect(() => validateApiResponseStrict(123)).toThrow('root: response must be an object');
    });
  });

  describe('validateSchema', () => {
    it('should create a validator for User schema', () => {
      const validate = validateSchema('User');
      const validUser = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'user',
        isActive: true,
      };
      expect(() => validate(validUser)).not.toThrow();
    });

    it('should throw for invalid User', () => {
      const validate = validateSchema('User');
      const invalidUser = { name: 'John' };
      expect(() => validate(invalidUser)).toThrow();
    });

    it('should create a validator for Ticket schema', () => {
      const validate = validateSchema('Ticket');
      const validTicket = {
        id: '1',
        title: 'Test',
        status: 'backlog',
        ownerId: '2',
        projectId: '3',
      };
      expect(() => validate(validTicket)).not.toThrow();
    });

    it('should throw for unknown schema', () => {
      expect(() => validateSchema('UnknownSchema')).toThrow('Unknown schema: UnknownSchema');
    });
  });

  describe('validateAndExtract', () => {
    it('should extract data when validation passes', () => {
      const data = { id: '1', name: 'Test', email: 'test@test.com', role: 'user', isActive: true };
      const result = validateAndExtract(data, validateUser, 'User');
      expect(result).toEqual(data);
    });

    it('should throw when validation fails', () => {
      const invalidData = { name: 'No ID' };
      expect(() => validateAndExtract(invalidData, validateUser, 'User')).toThrow();
    });
  });
});
