const { addProviderSchema, updateProviderSchema } = require('../validators/providers');

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

  describe('updateProviderSchema', () => {
    it('allows a type-only switch; the controller validates the resulting row', () => {
      const { error } = updateProviderSchema.validate({
        providerType: 'opencode',
      });

      expect(error).toBeUndefined();
    });

    it('accepts a type switch to OpenCode with a model', () => {
      const { error } = updateProviderSchema.validate({
        providerType: 'opencode',
        model: 'kimi-k2.6',
      });

      expect(error).toBeUndefined();
    });

    it('does not require a model when the type is unchanged', () => {
      const { error } = updateProviderSchema.validate({
        name: 'Renamed',
      });

      expect(error).toBeUndefined();
    });

    it('rejects an empty model', () => {
      const { error } = updateProviderSchema.validate({
        model: '',
      });

      expect(error).toBeDefined();
    });
  });
});
