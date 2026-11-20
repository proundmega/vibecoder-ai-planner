const Joi = require('joi');

const ROLE = Joi.string().valid('worker', 'reviewer', 'planner');
const EFFORT = Joi.string().valid('minimal', 'low', 'medium', 'high', 'max');

const enrollSchema = Joi.object({
  token: Joi.string().min(20).max(128).required(),
  name: Joi.string().min(1).max(100).required(),
  hostname: Joi.string().max(255).optional().allow(null, ''),
  fingerprint: Joi.string().max(255).optional().allow(null, ''),
});

const refreshSchema = Joi.object({
  refresh_token: Joi.string().min(20).max(128).required(),
  idempotency_key: Joi.string().min(16).max(128).optional(),
});

const mintSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  ttl_seconds: Joi.number().integer().min(60).max(86400).optional(),
  max_uses: Joi.number().integer().min(1).max(100).optional(),
});

const grantSchema = Joi.object({
  projectId: Joi.alternatives()
    .try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
    .required(),
  role: ROLE.required(),
});

const runtimeItemSchema = Joi.object({
  name: Joi.string().min(1).max(120).optional(),
  role: ROLE.required(),
  modelRef: Joi.string().min(1).max(300).required(),
  concurrency: Joi.number().integer().min(1).max(64).optional(),
  effort: EFFORT.optional().allow(null),
  projectId: Joi.alternatives()
    .try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
    .optional()
    .allow(null),
});

const declareRuntimesSchema = Joi.object({
  runtimes: Joi.array().items(runtimeItemSchema).min(1).max(100).required(),
});

const heartbeatSchema = Joi.object({
  status: Joi.string().valid('pending', 'running', 'draining', 'stopped').optional(),
  currentProjectId: Joi.alternatives()
    .try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
    .optional()
    .allow(null),
});

const runtimePatchSchema = Joi.object({
  effort: EFFORT.optional().allow(null),
  concurrency: Joi.number().integer().min(1).max(64).optional(),
  status: Joi.string().valid('pending', 'running', 'draining', 'stopped').optional(),
}).min(1);

module.exports = {
  enrollSchema,
  refreshSchema,
  mintSchema,
  grantSchema,
  declareRuntimesSchema,
  heartbeatSchema,
  runtimePatchSchema,
};
