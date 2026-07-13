const logger = require('../utils/logger');
const crypto = require('crypto');

const HEALTH_ENDPOINTS = new Set(['/api/health', '/api/version', '/health', '/version']);

const requestLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  req.requestId = crypto.randomUUID();
  req.startTime = startTime;

  const isHealthCheck = HEALTH_ENDPOINTS.has(req.path);

  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e6;
    const logData = {
      requestId: req.requestId,
      userId: req.user?.userId || req.user?.id || 'anonymous',
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration: Math.round(duration),
      userAgent: req.get('User-Agent'),
    };

    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Client error', logData);
    } else if (!isHealthCheck) {
      logger.info('Request completed', logData);
    }

    originalEnd.apply(res, args);
  };

  next();
};

module.exports = requestLogger;
