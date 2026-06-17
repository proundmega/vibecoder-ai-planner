const { validateEnv, formatEnvErrors, requiredEnvVars, optionalEnvVars } = require('../utils/envValidation');

describe('BP-10: Environment Variable Validation', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Object.keys(process.env).forEach(key => delete process.env[key]);
    Object.assign(process.env, originalEnv);
  });

  describe('validateEnv', () => {
    it('should pass when all required env vars are present', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      const result = validateEnv();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.invalid).toEqual([]);
    });

    it('should report missing required env vars', () => {
      process.env.JWT_SECRET = 'test-secret';
      const result = validateEnv();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('DATABASE_URL');
    });

    it('should apply defaults to missing optional env vars', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      delete process.env.NODE_ENV;
      delete process.env.PORT;
      delete process.env.LOG_LEVEL;
      
      validateEnv();
      
      expect(process.env.NODE_ENV).toBe('development');
      expect(process.env.PORT).toBe('3001');
      expect(process.env.LOG_LEVEL).toBe('info');
    });

    it('should validate NODE_ENV valid values', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.NODE_ENV = 'invalid';
      
      const result = validateEnv();
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual(expect.objectContaining({
        key: 'NODE_ENV',
        expected: 'one of [development, test, production]',
      }));
    });

    it('should validate integer env vars', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.PORT = 'not-a-number';
      
      const result = validateEnv();
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual(expect.objectContaining({
        key: 'PORT',
        expected: 'a positive integer',
      }));
    });

    it('should normalize integer env vars to string', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.PORT = '8080';
      
      validateEnv();
      
      expect(process.env.PORT).toBe('8080');
    });

    it('should reject negative integer env vars', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.PORT = '-1';
      
      const result = validateEnv();
      expect(result.valid).toBe(false);
    });

    it('should accept valid LOG_LEVEL values', () => {
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.LOG_LEVEL = 'debug';
      
      const result = validateEnv();
      expect(result.valid).toBe(true);
    });
  });

  describe('formatEnvErrors', () => {
    it('should format missing env var errors', () => {
      const errors = {
        missing: ['JWT_SECRET', 'DATABASE_URL'],
        invalid: [],
        valid: false,
      };
      const formatted = formatEnvErrors(errors);
      expect(formatted).toContain('Missing required environment variables');
      expect(formatted).toContain('JWT_SECRET');
      expect(formatted).toContain('DATABASE_URL');
    });

    it('should format invalid env var errors', () => {
      const errors = {
        missing: [],
        invalid: [{ key: 'PORT', value: 'abc', expected: 'a positive integer' }],
        valid: false,
      };
      const formatted = formatEnvErrors(errors);
      expect(formatted).toContain('Invalid environment variable values');
      expect(formatted).toContain('PORT=abc');
    });

    it('should format both missing and invalid errors', () => {
      const errors = {
        missing: ['JWT_SECRET'],
        invalid: [{ key: 'NODE_ENV', value: 'invalid', expected: 'one of [development, test, production]' }],
        valid: false,
      };
      const formatted = formatEnvErrors(errors);
      expect(formatted).toContain('Missing required environment variables');
      expect(formatted).toContain('Invalid environment variable values');
    });
  });

  describe('exports', () => {
    it('should export requiredEnvVars', () => {
      expect(Array.isArray(requiredEnvVars)).toBe(true);
      expect(requiredEnvVars.length).toBeGreaterThan(0);
    });

    it('should export optionalEnvVars', () => {
      expect(typeof optionalEnvVars).toBe('object');
      expect(Object.keys(optionalEnvVars).length).toBeGreaterThan(0);
    });

    it('should export validateEnv function', () => {
      expect(typeof validateEnv).toBe('function');
    });

    it('should export formatEnvErrors function', () => {
      expect(typeof formatEnvErrors).toBe('function');
    });
  });
});
