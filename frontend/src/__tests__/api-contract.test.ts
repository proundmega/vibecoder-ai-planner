import { describe, it, expect } from 'vitest';
import { validateUser, validateProject, validateTicket, validateAgent, validateApiResponse } from '../api/validator';

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
        id: '123e4567-e89b-12d3-a456-426614174000',
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
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'invalid_role',
        isActive: true,
      };
      const errors = validateUser(invalidUser);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should detect snake_case vs camelCase mismatch', () => {
      const snakeCaseUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
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
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Project',
        owner_id: '123e4567-e89b-12d3-a456-426614174001',
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
      expect(errors).toContain('root.owner_id: required field missing');
    });
  });

  describe('validateTicket', () => {
    it('should accept valid ticket object', () => {
      const validTicket = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Ticket',
        status: 'backlog',
        owner_id: '123e4567-e89b-12d3-a456-426614174001',
        project_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      const errors = validateTicket(validTicket);
      expect(errors).toHaveLength(0);
    });

    it('should reject ticket with invalid status', () => {
      const invalidTicket = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Ticket',
        status: 'invalid_status',
        owner_id: '123e4567-e89b-12d3-a456-426614174001',
        project_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      const errors = validateTicket(invalidTicket);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateAgent', () => {
    it('should accept valid agent object', () => {
      const validAgent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Agent',
        user_id: '123e4567-e89b-12d3-a456-426614174001',
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
      expect(errors).toContain('root.user_id: required field missing');
    });
  });
});
