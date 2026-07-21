const logger = require('../utils/logger');
const { createHistogram, createCounter } = require('../metrics');

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
      
      const path = req.route?.path || 'unmatched';
      const status = res.statusCode ? res.statusCode.toString() : 'unknown';
      httpRequestDurationHistogram.observe(
        { method: req.method, path, status },
        duration / 1000
      );
      httpRequestsTotal.inc({ method: req.method, path, status });
    });
    
    next();
  };
}

module.exports = { slowRequestLogger, httpRequestDurationHistogram, httpRequestsTotal };
