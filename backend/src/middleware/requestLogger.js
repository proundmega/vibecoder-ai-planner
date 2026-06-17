const logger = require('../utils/logger');
const crypto = require('crypto');

const requestLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  req.requestId = crypto.randomUUID();
  req.startTime = startTime;

  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e6;
    const logData = {
      requestId: req.requestId,
      userId: req.user?.userId || req.user?.id || 'anonymous',
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
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
    } else {
      logger.info('Request completed', logData);
    }

    originalEnd.apply(res, args);
  };

  next();
};

module.exports = requestLogger;
