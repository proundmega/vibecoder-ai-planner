const Joi = require('joi');

const kinds = ['question', 'permission', 'doom_loop'];
const statuses = ['pending', 'answered', 'expired', 'cancelled'];

const createQuestionSchema = Joi.object({
  kind: Joi.string().valid(...kinds).default('question'),
  externalId: Joi.string().max(255).allow(null, '').optional(),
  prompt: Joi.string().max(8192).required(),
  options: Joi.alternatives().try(Joi.array(), Joi.object()).allow(null).optional(),
  expiresAt: Joi.date().iso().allow(null).optional(),
});

const answerQuestionSchema = Joi.object({
  answer: Joi.string().max(8192).required(),
});

const questionListQuerySchema = Joi.object({
  status: Joi.string().valid(...statuses).optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const notificationListQuerySchema = Joi.object({
  unread: Joi.boolean().truthy('true').falsy('false').default(false),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

module.exports = {
  createQuestionSchema,
  answerQuestionSchema,
  questionListQuerySchema,
  notificationListQuerySchema,
  QUESTION_KINDS: kinds,
  QUESTION_STATUSES: statuses,
};
