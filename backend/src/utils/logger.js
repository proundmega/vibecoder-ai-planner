const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

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

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const rotationDays = parseInt(process.env.LOG_ROTATION_DAYS || '7', 10);
const rotationMaxSize = process.env.LOG_ROTATION_MAX_SIZE || '100m';
const rotationCompress = process.env.LOG_ROTATION_COMPRESS !== 'false';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'vibecode-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: `${rotationDays}d`,
      maxSize: rotationMaxSize,
      zippedArchive: rotationCompress,
      format: logFormat,
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${rotationDays}d`,
      maxSize: rotationMaxSize,
      zippedArchive: rotationCompress,
      format: logFormat,
    }),
  ],
  exitOnError: false,
});

logger.maskSensitive = maskSensitive;

module.exports = logger;
