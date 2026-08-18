const Joi = require('joi');

const TICKET_STATUSES = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical', 'urgent'];

const statusFilterSchema = Joi.object({
  status: Joi.string().valid(...TICKET_STATUSES).optional(),
  priority: Joi.string().valid(...PRIORITIES).optional(),
  is_active: Joi.boolean().optional(),
  search: Joi.string().max(500).optional(),
});

module.exports = { statusFilterSchema };
