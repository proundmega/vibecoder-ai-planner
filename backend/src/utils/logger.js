const winston = require('winston');

const SENSITIVE_FIELDS = ['password', 'token', 'apikey', 'authorization', 'secret', 'credit_card', 'ssn'];

function maskSensitive(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitive(item, depth + 1));
  }
  const masked = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field))) {
      masked[key] = typeof value === 'string' && value.length > 3 ? value.substring(0, 3) + '***' : '***';
    } else {
      masked[key] = maskSensitive(value, depth + 1);
    }
  }
  return masked;
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'vibecode-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    ...(process.env.NODE_ENV === 'production'
      ? [
          new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            )
          }),
          new winston.transports.File({ 
            filename: 'logs/combined.log',
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json()
            )
          }),
        ]
      : []),
  ],
  exitOnError: false,
});

logger.maskSensitive = maskSensitive;

module.exports = logger;
