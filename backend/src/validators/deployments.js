const Joi = require('joi');

const createEnvironmentSchema = Joi.object({
  name: Joi.string().min(1).max(64).required().messages({
    'string.empty': 'Environment name is required',
    'string.max': 'Environment name must not exceed 64 characters',
  }),
  webhook_url: Joi.string().uri().max(512).required().messages({
    'string.uri': 'Webhook URL must be a valid URL',
    'any.required': 'Webhook URL is required',
  }),
  branch_pattern: Joi.string().max(128).optional().default('*'),
});

const triggerDeploySchema = Joi.object({
  environment_id: Joi.string().uuid().required().messages({
    'string.guid': 'Environment ID must be a valid UUID',
    'any.required': 'Environment ID is required',
  }),
});

const updateDeploymentStatusSchema = Joi.object({
  status: Joi.string().valid('success', 'failed', 'triggered').required(),
});

module.exports = { createEnvironmentSchema, triggerDeploySchema, updateDeploymentStatusSchema };
