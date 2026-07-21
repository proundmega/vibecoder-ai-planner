const logger = require('../utils/logger');
const { createHistogram, createCounter } = require('../metrics');

// Metrics created here and registered in shared prom-client registry
// Actual recording happens in requestLogger.js to avoid double-counting
const httpRequestDurationHistogram = createHistogram(
  'http_request_duration_seconds',
  'HTTP request duration in seconds',
  ['method', 'path', 'status'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
);

const httpRequestsTotal = createCounter(
  'http_requests_total',
  'Total HTTP requests',
  ['method', 'path', 'status']
);

function slowRequestLogger(thresholdMs = 5000) {
  return (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > thresholdMs) {
        logger.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms (threshold: ${thresholdMs}ms)`);
      }
    });
    
    next();
  };
}

module.exports = { slowRequestLogger, httpRequestDurationHistogram, httpRequestsTotal };
