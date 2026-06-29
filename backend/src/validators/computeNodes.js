const Joi = require('joi');

const createNodeSchema = Joi.object({
  hostname: Joi.string().hostname().required().messages({
    'string.empty': 'hostname is required',
    'string.hostname': 'hostname must be a valid hostname',
    'any.required': 'hostname is required',
  }),
  ssh_port: Joi.number().port().optional().default(22),
  ssh_user: Joi.string().min(1).required().messages({
    'string.empty': 'ssh_user is required',
    'any.required': 'ssh_user is required',
  }),
  ssh_key_credential_id: Joi.string().uuid().required().messages({
    'string.empty': 'ssh_key_credential_id is required',
    'string.guid': 'ssh_key_credential_id must be a valid UUID',
    'any.required': 'ssh_key_credential_id is required',
  }),
  labels: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  capacity: Joi.number().integer().min(1).max(100).optional().default(1),
});

const updateNodeSchema = Joi.object({
  hostname: Joi.string().hostname().optional(),
  ssh_port: Joi.number().port().optional(),
  ssh_user: Joi.string().min(1).optional(),
  ssh_key_credential_id: Joi.string().uuid().optional(),
  labels: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  capacity: Joi.number().integer().min(1).max(100).optional(),
  status: Joi.string().optional(),
});

module.exports = { createNodeSchema, updateNodeSchema };
