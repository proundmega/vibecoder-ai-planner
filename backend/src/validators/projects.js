const Joi = require('joi');

const createProjectSchema = Joi.object({
  name: Joi.string().min(1).max(200).required().messages({
    'string.empty': 'Project name is required',
    'string.min': 'Project name must be at least 1 character',
    'string.max': 'Project name must not exceed 200 characters',
    'any.required': 'Project name is required',
  }),
  description: Joi.string().max(2000).allow('').optional().default(''),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(1).max(200).required().messages({
    'string.empty': 'Project name is required',
    'string.min': 'Project name must be at least 1 character',
    'string.max': 'Project name must not exceed 200 characters',
    'any.required': 'Project name is required',
  }),
  description: Joi.string().max(2000).allow('').optional().default(''),
});

module.exports = { createProjectSchema, updateProjectSchema };
