const Joi = require('joi');

const createTicketSchema = Joi.object({
  projectId: Joi.string().uuid().required().messages({
    'string.guid': 'projectId must be a valid UUID',
    'any.required': 'projectId is required',
  }),
  title: Joi.string().min(1).max(200).required().messages({
    'string.empty': 'title is required',
    'string.min': 'title must be at least 1 character',
    'string.max': 'title must not exceed 200 characters',
    'any.required': 'title is required',
  }),
  description: Joi.string().max(10000).allow('').optional(),
  tags: Joi.array().items(Joi.string()).max(10).optional(),
});

const editTicketSchema = Joi.object({
  title: Joi.string().min(1).max(200).optional(),
  description: Joi.string().max(10000).allow('').optional(),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'urgent').optional(),
  tags: Joi.array().items(Joi.string()).max(10).optional(),
});

const claimTicketSchema = Joi.object({
  ticketId: Joi.string().uuid().required().messages({
    'string.guid': 'ticketId must be a valid UUID',
    'any.required': 'ticketId is required',
  }),
});

const statusChangeSchema = Joi.object({
  ticketId: Joi.string().uuid().required().messages({
    'string.guid': 'ticketId must be a valid UUID',
    'any.required': 'ticketId is required',
  }),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').required().messages({
    'any.only': 'status must be one of: backlog, in_progress, review, done',
    'any.required': 'status is required',
  }),
});

module.exports = { createTicketSchema, editTicketSchema, claimTicketSchema, statusChangeSchema };
