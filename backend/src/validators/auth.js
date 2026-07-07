const Joi = require('joi');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const email = Joi.string().pattern(emailRegex).required().messages({
  'string.pattern.base': 'Email must be a valid email address',
  'any.required': 'Email is required',
});

const registerSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Name is required',
    'string.min': 'Name must be at least 1 character',
    'string.max': 'Name must not exceed 100 characters',
    'any.required': 'Name is required',
  }),
  email,
  password: Joi.string().min(6).max(128).required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
  role: Joi.string().valid('user', 'member', 'project_admin', 'super_admin').optional().default('project_admin'),
  user_created_by: Joi.string().uuid().optional(),
});

const loginSchema = Joi.object({
  email,
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
});

module.exports = { registerSchema, loginSchema };
