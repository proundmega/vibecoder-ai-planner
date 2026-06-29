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
  api_key_credential_id: Joi.string().uuid().allow(null).optional(),
  fallback_provider: Joi.string().allow('').optional(),
});

const testProviderConnectionSchema = Joi.object({
  endpoint_url: Joi.string().uri().required().messages({
    'string.empty': 'endpoint_url is required',
    'string.uri': 'endpoint_url must be a valid URI',
    'any.required': 'endpoint_url is required',
  }),
  model: Joi.string().optional(),
  api_key: Joi.string().optional(),
});

module.exports = { setProviderConfigSchema, testProviderConnectionSchema };
