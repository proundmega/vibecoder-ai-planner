const Joi = require('joi');

const createApprovalSchema = Joi.object({
  ticketId: Joi.alternatives().try(
    Joi.string().uuid().messages({ 'string.guid': 'ticketId must be a valid UUID' }),
    Joi.number().integer().positive().messages({ 'number.base': 'ticketId must be a valid number' })
  ).required().messages({
    'any.required': 'ticketId is required',
  }),
});

const approveSchema = Joi.object({
  comment: Joi.string().max(1000).allow('').optional(),
});

const rejectSchema = Joi.object({
  comment: Joi.string().max(1000).required().messages({
    'string.empty': 'comment is required',
    'any.required': 'comment is required',
  }),
});

module.exports = { createApprovalSchema, approveSchema, rejectSchema };
