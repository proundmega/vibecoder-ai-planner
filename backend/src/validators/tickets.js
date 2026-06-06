const Joi = require('joi');

const createTicketSchema = Joi.object({
  projectId: Joi.string().uuid().required().messages({
    'string.guid': 'Project ID must be a valid UUID',
    'any.required': 'Project ID is required',
  }),
  title: Joi.string().min(1).max(500).required().messages({
    'string.empty': 'Ticket title is required',
    'string.min': 'Ticket title must be at least 1 character',
    'string.max': 'Ticket title must not exceed 500 characters',
    'any.required': 'Ticket title is required',
  }),
  description: Joi.string().max(10000).allow('').optional().default(''),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional().default('medium'),
});

const updateTicketSchema = Joi.object({
  title: Joi.string().min(1).max(500).optional(),
  description: Joi.string().max(10000).allow('').optional(),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  assigneeId: Joi.string().uuid().allow(null).optional(),
});

const statusTransitionSchema = Joi.object({
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').required().messages({
    'any.only': 'Status must be one of: backlog, in_progress, review, done',
    'any.required': 'Status is required',
  }),
});

const commentSchema = Joi.object({
  content: Joi.string().min(1).max(5000).required().messages({
    'string.empty': 'Comment content is required',
    'string.min': 'Comment content must be at least 1 character',
    'string.max': 'Comment content must not exceed 5000 characters',
    'any.required': 'Comment content is required',
  }),
});

module.exports = { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema };
