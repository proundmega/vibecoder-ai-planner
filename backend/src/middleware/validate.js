const Joi = require('joi');

function sendValidationError(res, error) {
  const details = error.details.map(d => ({
    field: d.path.join('.'),
    message: d.message,
  }));
  return res.status(400).json({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details,
    },
  });
}

function validate(schema) {
  return (req, res, next) => {
    const options = {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false,
    };

    // Validate headers (if provided)
    if (schema.headers) {
      const { error } = schema.headers.validate(req.headers, options);
      if (error) return sendValidationError(res, error);
    }

    // Validate query params (if provided)
    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, options);
      if (error) return sendValidationError(res, error);
      req.query = value;
    }

    // Validate body (existing behavior)
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, options);
      if (error) return sendValidationError(res, error);
      req.body = value;
    } else if (schema.validate) {
      // Legacy: schema is the Joi object itself (not { body: Joi.object(...) })
      const { error, value } = schema.validate(req.body, options);
      if (error) return sendValidationError(res, error);
      req.body = value;
    }

    next();
  };
}

function validatePathParams(params) {
  return (req, res, next) => {
    for (const [key, schema] of Object.entries(params)) {
      const value = req.params[key];
      const { error } = schema.validate(value);
      if (error) return sendValidationError(res, error);
    }
    next();
  };
}

module.exports = { validate, validatePathParams };
