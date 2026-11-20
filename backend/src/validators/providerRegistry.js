const Joi = require('joi');

const ROLE = Joi.string().valid('worker', 'reviewer', 'planner');
const EFFORT = Joi.string().valid('minimal', 'low', 'medium', 'high', 'max');

const credentialCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  providerType: Joi.string().min(1).max(50).required(),
  apiKey: Joi.string().min(1).required(),
  baseUrl: Joi.string().uri({ allowRelative: false }).max(512).optional().allow(null, ''),
  projectId: Joi.alternatives()
    .try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
    .optional()
    .allow(null),
});

const credentialUpdateSchema = Joi.object({
  apiKey: Joi.string().min(1).optional(),
  baseUrl: Joi.string().uri({ allowRelative: false }).max(512).optional().allow(null, ''),
  status: Joi.string().valid('active', 'disabled').optional(),
}).min(1);

const modelCreateSchema = Joi.object({
  model: Joi.string().min(1).max(200).required(),
  displayName: Joi.string().max(200).optional().allow(null, ''),
  roles: Joi.array().items(ROLE).unique().default([]),
  effort: EFFORT.optional(),
  maxTokens: Joi.number().integer().min(1).optional().allow(null),
  contextWindow: Joi.number().integer().min(1).optional().allow(null),
});

const modelPatchSchema = Joi.object({
  roles: Joi.array().items(ROLE).unique().optional(),
  status: Joi.string().valid('unverified', 'verified', 'disabled').optional(),
  effort: EFFORT.optional(),
  maxTokens: Joi.number().integer().min(1).optional().allow(null),
}).min(1);

module.exports = {
  credentialCreateSchema,
  credentialUpdateSchema,
  modelCreateSchema,
  modelPatchSchema,
};
