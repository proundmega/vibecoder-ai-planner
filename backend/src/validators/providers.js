const Joi = require('joi');

const addProviderSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
  providerType: Joi.string().min(1).required().messages({
    'string.empty': 'providerType is required',
    'any.required': 'providerType is required',
  }),
  apiKey: Joi.string().allow('').optional(),
  baseUrl: Joi.string().uri().allow('').optional(),
  model: Joi.string().min(1).optional(),
  maxTokens: Joi.number().integer().min(1).optional(),
  temperature: Joi.number().min(0).max(1).optional(),
  roles: Joi.array().items(Joi.string()).optional(),
  endpoint_url: Joi.string().uri().allow('').optional(),
  fallback_provider: Joi.string().allow('').allow(null).optional(),
  routing_rules: Joi.object().optional(),
  is_project_director: Joi.boolean().optional(),
});

const updateProviderSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  providerType: Joi.string().min(1).optional(),
  apiKey: Joi.string().allow('').optional(),
  baseUrl: Joi.string().uri().allow('').optional(),
  model: Joi.string().min(1).optional(),
  maxTokens: Joi.number().integer().min(1).optional(),
  temperature: Joi.number().min(0).max(1).optional(),
  roles: Joi.array().items(Joi.string()).optional(),
  isActive: Joi.boolean().optional(),
  endpoint_url: Joi.string().uri().allow('').optional(),
  fallback_provider: Joi.string().allow('').allow(null).optional(),
  routing_rules: Joi.object().optional(),
  is_project_director: Joi.boolean().optional(),
});

module.exports = { addProviderSchema, updateProviderSchema };
