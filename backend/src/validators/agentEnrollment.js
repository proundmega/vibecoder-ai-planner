const Joi = require('joi');

const mintSchema = Joi.object({
  project_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/)).required(),
  name: Joi.string().min(1).max(100).required(),
  ttl_seconds: Joi.number().integer().min(60).max(86400).optional(),
  max_uses: Joi.number().integer().min(1).max(100).optional(),
  provider_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
    .optional().allow(null),
});

const enrollSchema = Joi.object({
  token: Joi.string().min(20).max(128).required(),
  name: Joi.string().min(1).max(100).required(),
  node_metadata: Joi.object().max(64).optional().default({}),
});

const refreshSchema = Joi.object({
  refresh_token: Joi.string().min(20).max(128).required(),
  // Required by the service, which returns IDEMPOTENCY_KEY_REQUIRED rather
  // than the generic validation envelope.
  idempotency_key: Joi.string().min(16).max(128).optional(),
});

const listQuerySchema = Joi.object({
  project_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/)).required(),
});

module.exports = {
  mintSchema,
  enrollSchema,
  refreshSchema,
  listQuerySchema,
};
