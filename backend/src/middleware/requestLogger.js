const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  });
  
  next();
}

module.exports = { requestLogger };
