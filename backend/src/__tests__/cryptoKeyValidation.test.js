describe('utils/crypto.js key validation (BP-58)', () => {
  let cryptoUtils;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    delete require.cache[require.resolve('../utils/crypto')];
  });

  afterEach(() => {
    Object.keys(originalEnv).forEach(key => {
      process.env[key] = originalEnv[key];
    });
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) delete process.env[key];
    });
  });

  it('throws when ENCRYPTION_KEY is missing (non-test env)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENCRYPTION_KEY;
    
    expect(() => {
      cryptoUtils = require('../utils/crypto');
    }).toThrow('ENCRYPTION_KEY environment variable is required');
  });

  it('throws when ENCRYPTION_KEY has wrong length', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENCRYPTION_KEY = '01234'; // Too short
    
    expect(() => {
      cryptoUtils = require('../utils/crypto');
    }).toThrow('ENCRYPTION_KEY must be a 64-character hexadecimal string');
  });

  it('throws when ENCRYPTION_KEY contains non-hex characters', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENCRYPTION_KEY = 'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg'; // Non-hex
    
    expect(() => {
      cryptoUtils = require('../utils/crypto');
    }).toThrow();
  });

  it('accepts valid 64-char hex ENCRYPTION_KEY', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    
    expect(() => {
      cryptoUtils = require('../utils/crypto');
    }).not.toThrow();
    
    cryptoUtils = require('../utils/crypto');
    expect(cryptoUtils.encrypt).toBeDefined();
    expect(cryptoUtils.decrypt).toBeDefined();
    expect(cryptoUtils.maskToken).toBeDefined();
  });

  it('encrypts and decrypts correctly with valid key', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    
    cryptoUtils = require('../utils/crypto');
    const original = 'Hello, World!';
    const encrypted = cryptoUtils.encrypt(original);
    const decrypted = cryptoUtils.decrypt(encrypted);
    
    expect(decrypted).toBe(original);
    expect(encrypted).not.toBe(original);
  });

  it('maskToken works with valid input', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    
    cryptoUtils = require('../utils/crypto');
    const masked = cryptoUtils.maskToken('my-secret-token');
    
    expect(masked).toContain('ken'); // Last 4 chars visible
    expect(masked).not.toBe('my-secret-token');
    // masked length should be at most 19 (15 stars + 4 visible)
    expect(masked.length).toBeLessThanOrEqual(19);
  });

  it('maskToken returns **** for short tokens', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    
    cryptoUtils = require('../utils/crypto');
    expect(cryptoUtils.maskToken('ab')).toBe('****');
    expect(cryptoUtils.maskToken('')).toBe('****');
    expect(cryptoUtils.maskToken(null)).toBe('****');
    expect(cryptoUtils.maskToken(undefined)).toBe('****');
  });

  it('works in test environment without ENCRYPTION_KEY', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENCRYPTION_KEY;
    
    // Should not throw in test mode
    expect(() => {
      cryptoUtils = require('../utils/crypto');
    }).not.toThrow();
  });
});
