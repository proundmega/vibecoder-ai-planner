const Joi = require('joi');

const requestAgentSchema = Joi.object({
  project_id: Joi.string().uuid().required().messages({
    'string.empty': 'project_id is required',
    'string.guid': 'project_id must be a valid UUID',
    'any.required': 'project_id is required',
  }),
  repo_url: Joi.string().uri().allow('').optional(),
  provider_id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  provider_config: Joi.object({
    endpoint: Joi.string().uri().optional(),
    apiKey: Joi.string().optional(),
    model: Joi.string().optional(),
  }).optional(),
});

const releaseAgentSchema = Joi.object({
  agent_id: Joi.string().required().messages({
    'string.empty': 'agent_id is required',
    'any.required': 'agent_id is required',
  }),
});

module.exports = { requestAgentSchema, releaseAgentSchema };
