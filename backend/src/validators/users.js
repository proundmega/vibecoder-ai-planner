const Joi = require('joi');

const createUserSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Name is required',
    'string.min': 'Name must be at least 1 character',
    'string.max': 'Name must not exceed 100 characters',
    'any.required': 'Name is required',
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Email must be a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(6).max(128).required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
  role: Joi.string().valid('user', 'member', 'project_admin').required().messages({
    'any.only': 'Role must be one of: user, member, project_admin',
    'any.required': 'Role is required',
  }),
});

const updateUserSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  role: Joi.string().valid('user', 'member', 'project_admin').optional(),
});

module.exports = { createUserSchema, updateUserSchema };
