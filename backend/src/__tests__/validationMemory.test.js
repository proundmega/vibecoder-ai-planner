const { validate } = require('../middleware/validate');
const { addMemorySchema, updateMemorySchema } = require('../validators/memory');

describe('BP-06: Input Validation - Memory Validators', () => {
  describe('addMemorySchema', () => {
    it('should validate valid memory creation', () => {
      const { error } = addMemorySchema.validate({
        content: 'Test memory content',
      });
      expect(!error).toBe(true);
    });

    it('should reject memory without content', () => {
      const { error } = addMemorySchema.validate({});
      expect(error).toBeDefined();
      expect(error.message).toContain('content');
    });

    it('should reject memory with empty content', () => {
      const { error } = addMemorySchema.validate({
        content: '',
      });
      expect(error).toBeDefined();
      expect(error.message).toContain('content');
    });

    it('should accept memory with embedding', () => {
      const { error } = addMemorySchema.validate({
        content: 'Test memory content',
        embedding: [0.1, 0.2, 0.3],
      });
      expect(!error).toBe(true);
    });
  });

  describe('updateMemorySchema', () => {
    it('should validate valid memory update', () => {
      const { error } = updateMemorySchema.validate({
        content: 'Updated content',
      });
      expect(!error).toBe(true);
    });

    it('should allow partial updates', () => {
      const { error } = updateMemorySchema.validate({
        content: 'Updated content',
      });
      expect(!error).toBe(true);
    });

    it('should accept empty update object', () => {
      const { error } = updateMemorySchema.validate({});
      expect(!error).toBe(true);
    });

    it('should accept update with embedding', () => {
      const { error } = updateMemorySchema.validate({
        embedding: [0.1, 0.2, 0.3],
      });
      expect(!error).toBe(true);
    });
  });
});
