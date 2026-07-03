const { ValidationError } = require('../errors/HttpError');

// Capture original JWT_SECRET before any tests run
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

describe('utils/jwt.js getSecret() (BP-58)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset modules to clear Jest's internal cache
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original JWT_SECRET
    if (ORIGINAL_JWT_SECRET !== undefined) {
      process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    
    const jwtUtils = require('../utils/jwt');
    
    expect(() => jwtUtils.getSecret()).toThrow(/JWT_SECRET environment variable is required/);
  });

  it('throws when JWT_SECRET is too short', () => {
    process.env.JWT_SECRET = 'short';
    
    const jwtUtils = require('../utils/jwt');
    
    expect(() => jwtUtils.getSecret()).toThrow(/JWT_SECRET must be at least 32 characters long/);
  });

  it('returns the secret when JWT_SECRET is valid (32+ chars)', () => {
    const validSecret = 'a'.repeat(32);
    process.env.JWT_SECRET = validSecret;
    
    const jwtUtils = require('../utils/jwt');
    const secret = jwtUtils.getSecret();
    
    expect(secret).toBe(validSecret);
  });

  it('caches the secret on first call', () => {
    process.env.JWT_SECRET = 'a'.repeat(32);
    
    const jwtUtils = require('../utils/jwt');
    const secret1 = jwtUtils.getSecret();
    const secret2 = jwtUtils.getSecret();
    
    expect(secret1).toBe(secret2);
  });

  it('returns same reference on subsequent calls', () => {
    process.env.JWT_SECRET = 'b'.repeat(40);
    
    const jwtUtils = require('../utils/jwt');
    const secret1 = jwtUtils.getSecret();
    const secret2 = jwtUtils.getSecret();
    
    expect(secret1 === secret2).toBe(true);
  });

  it('accepts exactly 32 character secret', () => {
    process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
    
    const jwtUtils = require('../utils/jwt');
    const secret = jwtUtils.getSecret();
    
    expect(secret).toBe('0123456789abcdef0123456789abcdef');
    expect(secret.length).toBe(32);
  });

  it('accepts secrets longer than 32 characters', () => {
    process.env.JWT_SECRET = 'this-is-a-very-long-secret-key-that-is-definitely-more-than-32-chars';
    
    const jwtUtils = require('../utils/jwt');
    const secret = jwtUtils.getSecret();
    
    expect(secret.length).toBeGreaterThan(32);
  });

  it('rejects 31 character secret (one short of minimum)', () => {
    process.env.JWT_SECRET = 'a'.repeat(31);
    
    const jwtUtils = require('../utils/jwt');
    
    expect(() => jwtUtils.getSecret()).toThrow('JWT_SECRET must be at least 32 characters long');
  });
});
