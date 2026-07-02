const Joi = require('joi');

const addMemorySchema = Joi.object({
  content: Joi.string().min(1).max(10000).required().messages({
    'string.empty': 'content is required',
    'string.min': 'content must be at least 1 character',
    'string.max': 'content must not exceed 10000 characters',
    'any.required': 'content is required',
  }),
  metadata: Joi.object().optional(),
  embedding: Joi.array().items(Joi.number()).optional(),
});

const updateMemorySchema = Joi.object({
  content: Joi.string().min(1).max(10000).optional(),
  embedding: Joi.array().items(Joi.number()).optional(),
});

module.exports = { addMemorySchema, updateMemorySchema };
