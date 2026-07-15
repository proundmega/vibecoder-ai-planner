const { createTicketSchema, editTicketSchema, claimTicketSchema, statusChangeSchema } = require('../validators/agents');

describe('BP-06: Input Validation - Agents Validators', () => {
  describe('createTicketSchema', () => {
    it('should validate valid ticket creation', () => {
      const { error, value } = createTicketSchema.validate({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Ticket',
        description: 'Test description',
        tags: ['bug', 'frontend'],
      });
      expect(!error).toBe(true);
      expect(value.title).toBe('Test Ticket');
    });

    it('should reject ticket without title', () => {
      const { error } = createTicketSchema.validate({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('title');
    });

    it('should reject ticket without projectId', () => {
      const { error } = createTicketSchema.validate({
        title: 'Test Ticket',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('projectId');
    });

    it('should reject invalid projectId format', () => {
      const { error } = createTicketSchema.validate({
        projectId: 'not-a-uuid',
        title: 'Test Ticket',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('projectId');
    });
  });

  describe('editTicketSchema', () => {
    it('should validate valid ticket update', () => {
      const { error, value } = editTicketSchema.validate({
        title: 'Updated Title',
        status: 'in_progress',
      });
      expect(!error).toBe(true);
      expect(value.title).toBe('Updated Title');
    });

    it('should allow partial updates', () => {
      const { error } = editTicketSchema.validate({
        title: 'Updated Title',
      });
      expect(!error).toBe(true);
    });

    it('should reject invalid status values', () => {
      const { error } = editTicketSchema.validate({
        status: 'invalid_status',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('status');
    });
  });

  describe('claimTicketSchema', () => {
    it('should validate valid claim', () => {
      const { error } = claimTicketSchema.validate({
        ticketId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(!error).toBe(true);
    });

    it('should reject invalid ticketId', () => {
      const { error } = claimTicketSchema.validate({
        ticketId: 'not-a-uuid',
      });
      expect(error).toBeDefined();
    });
  });

  describe('statusChangeSchema', () => {
    it('should validate valid status', () => {
      const { error } = statusChangeSchema.validate({
        ticketId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'in_progress',
      });
      expect(!error).toBe(true);
    });

    it('should reject missing status', () => {
      const { error } = statusChangeSchema.validate({
        ticketId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('status');
    });

    it('should reject invalid status', () => {
      const { error } = statusChangeSchema.validate({
        ticketId: '123e4567-e89b-12d3-a456-426614174000',
        status: 'invalid',
      });
      expect(error).toBeDefined();
    });
  });
});
