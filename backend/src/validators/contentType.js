const Joi = require('joi');

const jsonContentTypeSchema = Joi.object({
  'content-type': Joi.string().valid('application/json').required(),
}).options({ allowUnknown: true, stripUnknown: false });

module.exports = { jsonContentTypeSchema };
