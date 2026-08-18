const Joi = require('joi');

const createTicketSchema = Joi.object({
  projectId: Joi.alternatives().try(
    Joi.string().uuid().messages({ 'string.guid': 'Project ID must be a valid UUID' }),
    Joi.number().integer().positive().messages({ 'number.base': 'Project ID must be a valid number' })
  ).required().messages({
    'any.required': 'Project ID is required',
  }),
  title: Joi.string().min(1).max(500).required().messages({
    'string.empty': 'Ticket title is required',
    'string.min': 'Ticket title must be at least 1 character',
    'string.max': 'Ticket title must not exceed 500 characters',
    'any.required': 'Ticket title is required',
  }),
  description: Joi.string().max(10000).allow('').optional().default(''),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical', 'urgent').optional().default('medium'),
});

const updateTicketSchema = Joi.object({
  title: Joi.string().min(1).max(500).optional(),
  description: Joi.string().max(10000).allow('').optional(),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical', 'urgent').optional(),
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
  file_path: Joi.string().max(512).optional(),
  line_number: Joi.number().integer().min(1).optional(),
});

const phaseTransitionSchema = Joi.object({
  toPhase: Joi.string().valid(
    'draft', 'planning', 'plan_approved', 'assigned',
    'in_progress', 'blocked', 'review', 'human_approval',
    'done', 'deployed'
  ).required().messages({
    'any.only': 'toPhase must be one of: draft, planning, plan_approved, assigned, in_progress, blocked, review, human_approval, done, deployed',
    'any.required': 'toPhase is required',
  }),
  actorType: Joi.string().valid('human', 'agent', 'system').optional().default('human'),
  metadata: Joi.object().optional(),
});

const postMessageSchema = Joi.object({
  messageType: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'Message type is required',
    'string.min': 'Message type must be at least 1 character',
    'string.max': 'Message type must not exceed 100 characters',
    'any.required': 'Message type is required',
  }),
  content: Joi.string().min(1).max(50000).required().messages({
    'string.empty': 'Message content is required',
    'string.min': 'Message content must be at least 1 character',
    'string.max': 'Message content must not exceed 50000 characters',
    'any.required': 'Message content is required',
  }),
  metadata: Joi.object().optional(),
});

module.exports = { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema, phaseTransitionSchema, postMessageSchema };
