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
  // fg-45: creation stays permissive; these only seed planning state.
  template: Joi.string().valid('architecture', 'technical', 'simple', 'specification').optional(),
  acceptanceCriteria: Joi.array().items(Joi.string().min(1).max(2000)).optional(),
  smallFix: Joi.object({
    reason: Joi.string().min(10).max(2000).required(),
  }).optional(),
});

const updateTicketSchema = Joi.object({
  title: Joi.string().min(1).max(500).optional(),
  description: Joi.string().max(10000).allow('').optional(),
  status: Joi.string().valid('backlog', 'in_progress', 'review', 'done').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical', 'urgent').optional(),
  assigneeId: Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().pattern(/^\d+$/)
  ).allow(null).optional(),
  milestoneId: Joi.string().uuid().allow(null).optional().messages({
    'string.guid': 'Milestone ID must be a valid UUID',
  }),
  estimate: Joi.number().integer().positive().allow(null).optional().messages({
    'number.positive': 'Estimate must be a positive integer',
    'number.integer': 'Estimate must be a positive integer',
  }),
  dependsOn: Joi.array().items(
    Joi.alternatives().try(
      Joi.number().integer().positive(),
      Joi.string().pattern(/^\d+$/)
    )
  ).allow(null).optional().messages({
    'array.base': 'Dependencies must be an array of ticket IDs',
  }),
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
  // Derived from the credential by the route; a body value is only allowed to
  // match it, never to override it.
  actorType: Joi.string().valid('human', 'agent', 'system').optional(),
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

const readinessOverrideSchema = Joi.object({
  codes: Joi.array().items(Joi.string().min(1).max(80)).min(1).required().messages({
    'array.min': 'At least one issue code must be waived',
    'any.required': 'Issue codes are required',
  }),
  reason: Joi.string().min(10).max(2000).required().messages({
    'string.min': 'An override reason of at least 10 characters is required',
    'any.required': 'An override reason is required',
  }),
  expiresAt: Joi.date().iso().required().messages({
    'any.required': 'An override expiry is required',
  }),
});

const smallFixSchema = Joi.object({
  reason: Joi.string().min(10).max(2000).required().messages({
    'string.min': 'A small-fix reason of at least 10 characters is required',
    'any.required': 'A small-fix reason is required',
  }),
});

const acceptanceCriteriaSchema = Joi.alternatives().try(
  Joi.array().items(
    Joi.alternatives().try(
      Joi.string().min(1).max(2000),
      Joi.object({ text: Joi.string().min(1).max(2000).required(), position: Joi.number().integer().min(0).optional() })
    )
  ).min(1),
  Joi.object({
    criteria: Joi.array().items(
      Joi.alternatives().try(
        Joi.string().min(1).max(2000),
        Joi.object({ text: Joi.string().min(1).max(2000).required(), position: Joi.number().integer().min(0).optional() })
      )
    ).min(1).required(),
  })
);

const criterionSchema = Joi.object({
  text: Joi.string().min(1).max(2000).required().messages({
    'string.empty': 'Criterion text is required',
    'any.required': 'Criterion text is required',
  }),
});

module.exports = {
  createTicketSchema,
  updateTicketSchema,
  statusTransitionSchema,
  commentSchema,
  phaseTransitionSchema,
  postMessageSchema,
  readinessOverrideSchema,
  smallFixSchema,
  acceptanceCriteriaSchema,
  criterionSchema,
};
