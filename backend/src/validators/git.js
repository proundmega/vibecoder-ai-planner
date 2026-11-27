const Joi = require('joi');
const { PROVIDER_IDS } = require('../providers/git');

const provider = Joi.string().lowercase().valid(...PROVIDER_IDS);

// Path params stay strings, so require a canonical positive bigint instead of
// the numeric conversion `Joi.number()` would accept and then discard.
const idPathParam = Joi.string()
  .pattern(/^[1-9]\d{0,18}$/)
  .custom((value, helpers) => (
    BigInt(value) <= 9223372036854775807n ? value : helpers.error('any.invalid')
  ))
  .messages({
    'string.pattern.base': 'must be a positive integer id',
    'any.invalid': 'must be a positive integer id',
  });

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

/**
 * Git ref names come from the agent, so reject the characters and sequences
 * git refuses before they reach a provider URL or request body.
 */
const branchName = Joi.string()
  .min(1)
  .max(200)
  .pattern(/^[A-Za-z0-9._/-]+$/)
  .custom((value, helpers) => {
    const invalid = value.startsWith('/') || value.endsWith('/')
      || value.endsWith('.') || value.startsWith('-')
      || value.includes('..') || value.includes('//') || value.includes('@{');
    return invalid ? helpers.error('any.invalid') : value;
  })
  .messages({
    'string.pattern.base': 'must be a valid git branch name',
    'any.invalid': 'must be a valid git branch name',
  });

const reviewRequestSchema = Joi.object({
  provider: provider.optional(),
  description: Joi.string().max(10000).allow('').optional(),
  headBranch: branchName.optional(),
  baseBranch: branchName.optional(),
});

module.exports = {
  connectRepoSchema,
  reviewRequestSchema,
  idPathParam,
};
