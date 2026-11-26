const Joi = require('joi');
const { PROVIDER_IDS } = require('../providers/git');

const provider = Joi.string().lowercase().valid(...PROVIDER_IDS);

const connectRepoSchema = Joi.object({
  provider: provider.default('github'),
  repoUrl: Joi.string().trim().min(1).max(2000).required().messages({
    'string.empty': 'repoUrl is required',
    'any.required': 'repoUrl is required',
  }),
  baseUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(2000).optional(),
  authMode: Joi.string().lowercase().valid('app', 'pat', 'project_token', 'ssh').optional(),
  token: Joi.string().min(1).max(4096).optional(),
  accessToken: Joi.string().min(1).max(4096).optional(),
  sshKey: Joi.string().min(1).max(20000).optional(),
  defaultBranch: Joi.string().min(1).max(200).optional(),
  providerProjectId: Joi.string().max(200).optional(),
});

const reviewRequestSchema = Joi.object({
  provider: provider.optional(),
  description: Joi.string().max(10000).allow('').optional(),
});

module.exports = {
  connectRepoSchema,
  reviewRequestSchema,
};
