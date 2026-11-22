class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

class DependencyConflictError extends ConflictError {
  constructor(message = 'Dependencies are not done', details = null) {
    super(message);
    this.code = 'DEPENDENCIES_NOT_DONE';
    this.details = details;
  }
}

/**
 * fg-45: a ticket is not ready for execution. 409 because the ticket state
 * conflicts with the requested transition. `details.issues` is machine-readable
 * and `result` carries the internal context for the post-transaction audit row.
 */
class ReadinessError extends AppError {
  constructor(result = {}, message = 'Ticket is not ready') {
    super(message, 409, 'READINESS_FAILED');
    this.result = result;
    this.details = {
      issues: Array.isArray(result.issues) ? result.issues : [],
      waivedCodes: Array.isArray(result.waivedCodes) ? result.waivedCodes : [],
    };
  }
}

/**
 * fg-45: `planning_status=completed` is service-owned. The planning status
 * route rejects direct completion and any move out of the completed state.
 */
class PlanningStatusError extends ConflictError {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

class UtilityError extends AppError {
  constructor(message = 'Utility error', statusCode = 500) {
    super(message, statusCode, 'UTILITY_ERROR');
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  ConflictError,
  DependencyConflictError,
  ReadinessError,
  PlanningStatusError,
  RateLimitError,
  ServiceUnavailableError,
  UtilityError,
};
