// Winston mock
jest.mock('winston', () => {
  const MockConsole = jest.fn().mockImplementation(() => ({
    level: jest.fn(),
    format: jest.fn(),
    write: jest.fn()
  }));

  return {
    createLogger: jest.fn(() => ({
      level: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      format: {
        combine: jest.fn(() => ({ timestamp: jest.fn(), json: jest.fn() })),
        timestamp: jest.fn(),
        json: jest.fn(),
        colorize: jest.fn(),
        simple: jest.fn()
      },
      transports: [new MockConsole()],
      exit: jest.fn(),
      exitOnError: false
    })),
    format: {
      combine: jest.fn(() => ({ timestamp: jest.fn(), json: jest.fn() })),
      timestamp: jest.fn(),
      json: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn()
    },
    transports: {
      Console: MockConsole,
      File: MockConsole,
      Http: MockConsole,
      Stream: MockConsole
    }
  };
});

// logger mock
jest.mock('../utils/logger', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    maskSensitive: jest.fn((obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(item => mockLogger.maskSensitive(item));
      const SENSITIVE_FIELDS = ['password', 'token', 'apikey', 'authorization', 'secret', 'credit_card', 'ssn'];
      const masked = {};
      for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field))) {
          masked[key] = typeof value === 'string' && value.length > 3 ? value.substring(0, 3) + '***' : '***';
        } else {
          masked[key] = mockLogger.maskSensitive(value);
        }
      }
      return masked;
    }),
  };
  return mockLogger;
});

// pg.Pool mock
jest.mock('pg', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  };
  return { Pool: jest.fn().mockImplementation(() => pool) };
});

// bcryptjs mock
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('mock-hash'),
  compare: jest.fn().mockResolvedValue(true)
}));

// uuid mock
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid')
}));

// jwt mock
jest.mock('jsonwebtoken', () => {
  return {
    verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com' }),
    sign: jest.fn().mockReturnValue('mock-token')
  };
});
