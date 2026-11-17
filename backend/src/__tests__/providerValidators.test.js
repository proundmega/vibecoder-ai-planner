const { addProviderSchema } = require('../validators/providers');

describe('provider validators', () => {
  describe('addProviderSchema', () => {
    it('requires a model for OpenCode providers', () => {
      const { error } = addProviderSchema.validate({
        name: 'OpenCode Zen',
        providerType: 'opencode',
      });

      expect(error).toBeDefined();
      expect(error.details[0].message).toContain('model is required');
    });

    it('accepts an OpenCode provider with a model', () => {
      const { error } = addProviderSchema.validate({
        name: 'OpenCode Zen',
        providerType: 'opencode',
        model: 'kimi-k2.6',
      });

      expect(error).toBeUndefined();
    });

    it('does not require a model for other provider types', () => {
      const { error } = addProviderSchema.validate({
        name: 'OpenAI',
        providerType: 'openai',
      });

      expect(error).toBeUndefined();
    });
  });
});
