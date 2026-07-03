const Joi = require('joi');

const setProviderConfigSchema = Joi.object({
  provider: Joi.string().min(1).required().messages({
    'string.empty': 'provider is required',
    'any.required': 'provider is required',
  }),
  endpoint_url: Joi.string().uri().allow('').optional(),
  model: Joi.string().min(1).required().messages({
    'string.empty': 'model is required',
    'any.required': 'model is required',
  }),
  api_key: Joi.string().allow('').optional(),
  fallback_provider: Joi.string().allow('').allow(null).optional(),
}).custom((value, helpers) => {
  const { provider, endpoint_url } = value;
  if (provider && !LOCAL_PROVIDER_TYPES.includes(provider) && endpoint_url === '') {
    return helpers.error('any.invalid', { value: 'endpoint_url cannot be empty for cloud providers' });
  }
  return value;
});

const LOCAL_PROVIDER_TYPES = ['ollama', 'vllm', 'llamacpp', 'custom'];

const testProviderConnectionSchema = Joi.object({
  provider: Joi.string().optional(),
  endpoint_url: Joi.string().uri().allow('').optional(),
  model: Joi.string().optional(),
  api_key: Joi.string().allow('').optional(),
  fallback_provider: Joi.string().allow('').allow(null).optional(),
}).custom((value, helpers) => {
  const { provider, endpoint_url } = value;
  if (provider && !LOCAL_PROVIDER_TYPES.includes(provider) && endpoint_url === '') {
    return helpers.error('any.invalid', { value: 'endpoint_url cannot be empty for cloud providers' });
  }
  return value;
});

const resolveProviderSchema = Joi.object({
  ticket_id: Joi.string().uuid().optional(),
  labels: Joi.array().items(Joi.string()).optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  phase: Joi.string().optional(),
});

module.exports = { setProviderConfigSchema, testProviderConnectionSchema, resolveProviderSchema };
