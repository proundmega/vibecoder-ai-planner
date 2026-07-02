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
});

const updateProviderSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  providerType: Joi.string().min(1).optional(),
  apiKey: Joi.string().allow('').optional(),
  baseUrl: Joi.string().uri().allow('').optional(),
});

module.exports = { addProviderSchema, updateProviderSchema };
