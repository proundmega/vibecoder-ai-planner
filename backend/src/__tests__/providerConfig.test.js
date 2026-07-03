const Joi = require('joi');
const { setProviderConfigSchema, testProviderConnectionSchema } = require('../validators/providerConfig');

describe('providerConfig validators', () => {
  describe('setProviderConfigSchema', () => {
    it('should accept empty endpoint_url for local providers', () => {
      const { error, value } = setProviderConfigSchema.validate({
        provider: 'ollama',
        model: 'llama3',
        endpoint_url: '',
      });
      expect(error).toBeUndefined();
    });

    it('should reject empty endpoint_url for cloud providers', () => {
      const { error } = setProviderConfigSchema.validate({
        provider: 'openai',
        model: 'gpt-4o',
        endpoint_url: '',
      });
      expect(error).toBeDefined();
    });

    it('should accept valid URI endpoint_url for cloud providers', () => {
      const { error } = setProviderConfigSchema.validate({
        provider: 'openai',
        model: 'gpt-4o',
        endpoint_url: 'http://localhost:8080/v1',
      });
      expect(error).toBeUndefined();
    });

    it('should accept no endpoint_url for cloud providers', () => {
      const { error } = setProviderConfigSchema.validate({
        provider: 'openai',
        model: 'gpt-4o',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('testProviderConnectionSchema', () => {
    it('should accept empty endpoint_url for local providers', () => {
      const { error } = testProviderConnectionSchema.validate({
        provider: 'vllm',
        model: 'meta-llama/Llama-3-8b',
        endpoint_url: '',
      });
      expect(error).toBeUndefined();
    });

    it('should reject empty endpoint_url for cloud providers', () => {
      const { error } = testProviderConnectionSchema.validate({
        provider: 'claude',
        model: 'claude-3-opus',
        endpoint_url: '',
      });
      expect(error).toBeDefined();
    });

    it('should accept valid URI endpoint_url for cloud providers', () => {
      const { error } = testProviderConnectionSchema.validate({
        provider: 'openai',
        model: 'gpt-4o',
        endpoint_url: 'https://api.openai.com/v1',
      });
      expect(error).toBeUndefined();
    });

    it('should accept no endpoint_url when provider not specified', () => {
      const { error } = testProviderConnectionSchema.validate({
        model: 'gpt-4o',
      });
      expect(error).toBeUndefined();
    });
  });
});
