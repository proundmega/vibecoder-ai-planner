const logger = require('./logger');

const requiredEnvVars = [
  { key: 'JWT_SECRET', description: 'JWT signing secret (min 32 chars)' },
  { key: 'DATABASE_URL', description: 'PostgreSQL connection string' },
  { key: 'ENCRYPTION_KEY', description: 'AES-256 encryption key (64 hex chars)' },
];

const productionRequiredEnvVars = [
  { key: 'REDIS_URL', description: 'Redis connection string' },
];

const optionalEnvVars = {
  NODE_ENV: { validValues: ['development', 'test', 'production'], default: 'development' },
  PORT: { type: 'int', default: 3001 },
  LOG_LEVEL: { validValues: ['error', 'warn', 'info', 'debug'], default: 'info' },
  AUTH_LOCKOUT_ATTEMPTS: { type: 'int', default: 10 },
  AUTH_LOCKOUT_WINDOW_MS: { type: 'int', default: 900000 },
  REQUEST_TIMEOUT_MS: { type: 'int', default: 30000 },
  SLOW_REQUEST_THRESHOLD_MS: { type: 'int', default: 5000 },
  ALLOWED_ORIGINS: { type: 'string', default: 'http://localhost:3000,http://localhost:3002' },
  DATABASE_POOL_MAX: { type: 'int', default: 20 },
  DATABASE_IDLE_TIMEOUT_MS: { type: 'int', default: 30000 },
  DATABASE_CONNECTION_TIMEOUT_MS: { type: 'int', default: 5000 },
  DATABASE_MAX_USES: { type: 'int', default: 10000 },
  LOG_AGGREGATION_URL: { type: 'string', default: '' },
  LOG_AGGREGATION_API_KEY: { type: 'string', default: '' },
  LOG_AGGREGATION_SOURCE: { type: 'string', default: 'vibecode-api' },
};

function validateEnv() {
  const missing = [];
  const invalid = [];

  for (const { key, description: _description } of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  for (const [key, config] of Object.entries(optionalEnvVars)) {
    const value = process.env[key];
    if (value === undefined || value === '') {
      process.env[key] = config.default;
      continue;
    }

    if (config.validValues && !config.validValues.includes(value)) {
      invalid.push({
        key,
        value,
        expected: `one of [${config.validValues.join(', ')}]`,
      });
    }

    if (config.type === 'int') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        invalid.push({
          key,
          value,
          expected: 'a positive integer',
        });
      } else {
        process.env[key] = String(num);
      }
    }
  }

  // JWT_SECRET must be at least 32 characters
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    invalid.push({
      key: 'JWT_SECRET',
      value: '(too short)',
      expected: 'at least 32 characters',
    });
  }

  // ENCRYPTION_KEY must be exactly 64 hex characters
  if (process.env.ENCRYPTION_KEY) {
    const encKey = process.env.ENCRYPTION_KEY;
    if (!/^[0-9a-f]{64}$/i.test(encKey)) {
      invalid.push({
        key: 'ENCRYPTION_KEY',
        value: '(invalid format)',
        expected: '64 hexadecimal characters (256-bit key)',
      });
    }
  }

  // REDIS_URL required in production
  if (process.env.NODE_ENV === 'production') {
    for (const { key, description: _description } of productionRequiredEnvVars) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  }

  return { missing, invalid, valid: missing.length === 0 && invalid.length === 0 };
}

function formatEnvErrors(errors) {
  const lines = [];
  if (errors.missing.length > 0) {
    lines.push('Missing required environment variables:');
    for (const key of errors.missing) {
      const varDef = requiredEnvVars.find(v => v.key === key);
      const prodVarDef = productionRequiredEnvVars.find(v => v.key === key);
      const description = varDef?.description || prodVarDef?.description || '';
      lines.push(`  - ${key} (${description})`);
    }
  }
  if (errors.invalid.length > 0) {
    lines.push('Invalid environment variable values:');
    for (const { key, value, expected } of errors.invalid) {
      lines.push(`  - ${key}=${value} (expected ${expected})`);
    }
  }
  return lines.join('\n');
}

if (process.env.NODE_ENV !== 'test') {
  const result = validateEnv();
  if (!result.valid) {
    logger.error('\n' + formatEnvErrors(result) + '\n');
    logger.error('Environment validation failed. Please check your .env file.\n');
    process.exit(1);
  } else {
    logger.info('Environment variables validated successfully.');
  }
}

module.exports = { validateEnv, formatEnvErrors, requiredEnvVars, productionRequiredEnvVars, optionalEnvVars };
