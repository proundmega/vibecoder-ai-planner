const Joi = require('joi');

const addCredentialSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
  key: Joi.string().min(1).required().messages({
    'string.empty': 'key is required',
    'any.required': 'key is required',
  }),
  type: Joi.string().valid('api_key', 'oauth', 'bearer').optional().default('api_key'),
});

const updateCredentialSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  key: Joi.string().min(1).optional(),
  type: Joi.string().valid('api_key', 'oauth', 'bearer').optional(),
});

module.exports = { addCredentialSchema, updateCredentialSchema };
