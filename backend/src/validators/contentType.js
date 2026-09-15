const Joi = require('joi');

const jsonContentTypeSchema = Joi.object({
  'content-type': Joi.string().pattern(/^application\/json(;.*)?$/).required(),
}).options({ allowUnknown: true, stripUnknown: false });

module.exports = { jsonContentTypeSchema };
