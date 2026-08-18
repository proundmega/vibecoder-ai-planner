const Joi = require('joi');
const { AppError } = require('../errors/HttpError');
const logger = require('../utils/logger');

const errorResponseSchema = Joi.object({
  success: Joi.boolean().valid(false).required(),
  error: Joi.object({
    code: Joi.string().required(),
    message: Joi.string().required(),
    details: Joi.array().optional(),
  }).required(),
});

function validateResponse(response) {
  const { error } = errorResponseSchema.validate(response, { abortEarly: false });
  if (error) {
    logger.error('Response validation failed:', error.message);
    return false;
  }
  return true;
}

function sendErrorResponse(res, statusCode, body) {
  if (process.env.RESPONSE_VALIDATION === 'true') {
    if (!validateResponse(body)) {
      logger.warn('Sending sanitized error response due to validation failure');
      body = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      };
      statusCode = 500;
    }
  }
  res.status(statusCode).json(body);
}

function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || 'N/A';
  logger.error(`[ERROR] Request ${requestId}:`, err.message);
  if (process.env.NODE_ENV === 'development' && err.stack) {
    logger.error(err.stack);
  }

  let statusCode = 500;
  let body;

  if (err instanceof AppError) {
    statusCode = err.statusCode || 500;
    body = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    body = {
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
    };
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    body = {
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired',
      },
    };
  } else if (err.code === '23505') {
    statusCode = 409;
    body = {
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists',
      },
    };
  } else {
    statusCode = err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    body = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction ? 'Internal server error' : err.message,
        ...(isProduction ? {} : { stack: err.stack }),
      },
    };
  }

  sendErrorResponse(res, statusCode, body);
}

module.exports = { errorHandler };
