const { createApprovalSchema, approveSchema, rejectSchema } = require('../validators/approvals');

describe('BP-06: Input Validation - Approvals Validators', () => {
  describe('createApprovalSchema', () => {
    it('should validate valid approval creation', () => {
      const { error } = createApprovalSchema.validate({
        ticketId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(!error).toBe(true);
    });

    it('should reject approval without ticketId', () => {
      const { error } = createApprovalSchema.validate({});
      expect(error).toBeDefined();
      expect(error.message).toContain('ticketId');
    });

    it('should reject invalid ticketId format', () => {
      const { error } = createApprovalSchema.validate({
        ticketId: 'not-a-uuid',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('ticketId');
    });
  });

  describe('approveSchema', () => {
    it('should validate approval with comment', () => {
      const { error } = approveSchema.validate({
        comment: 'Looks good',
      });
      expect(!error).toBe(true);
    });

    it('should validate approval without comment', () => {
      const { error } = approveSchema.validate({});
      expect(!error).toBe(true);
    });
  });

  describe('rejectSchema', () => {
    it('should validate rejection with comment', () => {
      const { error } = rejectSchema.validate({
        comment: 'Needs more work',
      });
      expect(!error).toBe(true);
    });

    it('should reject approval without comment', () => {
      const { error } = rejectSchema.validate({});
      expect(error).toBeDefined();
      expect(error.message).toContain('comment');
    });

    it('should reject rejection with empty comment', () => {
      const { error } = rejectSchema.validate({
        comment: '',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('comment');
    });
  });
});
