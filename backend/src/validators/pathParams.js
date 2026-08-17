const Joi = require('joi');

const pathParams = {
  id: Joi.number().integer().positive(),
  ticketId: Joi.number().integer().positive(),
  projectId: Joi.number().integer().positive(),
  agentId: Joi.number().integer().positive(),
  userId: Joi.number().integer().positive(),
  credentialId: Joi.number().integer().positive(),
  deploymentId: Joi.number().integer().positive(),
  environmentId: Joi.number().integer().positive(),
  milestoneId: Joi.number().integer().positive(),
  approvalId: Joi.number().integer().positive(),
  messageId: Joi.number().integer().positive(),
  templateId: Joi.number().integer().positive(),
  attachmentId: Joi.number().integer().positive(),
  providerId: Joi.number().integer().positive(),
};

module.exports = { pathParams };
