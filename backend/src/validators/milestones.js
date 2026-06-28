const Joi = require('joi');

const createMilestoneSchema = Joi.object({
  name: Joi.string().min(1).max(128).required().messages({
    'string.empty': 'Milestone name is required',
    'string.max': 'Milestone name must not exceed 128 characters',
  }),
  description: Joi.string().allow('').optional(),
  target_date: Joi.alternatives().try(
    Joi.date().iso(),
    Joi.string().empty()
  ).optional(),
});

const updateMilestoneSchema = Joi.object({
  name: Joi.string().min(1).max(128).optional(),
  description: Joi.string().allow('').optional(),
  target_date: Joi.alternatives().try(
    Joi.date().iso(),
    Joi.string().empty()
  ).optional(),
}).min(1);

module.exports = { createMilestoneSchema, updateMilestoneSchema };
