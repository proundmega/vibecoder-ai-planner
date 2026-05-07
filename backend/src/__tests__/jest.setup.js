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

// pg.Pool mock
jest.mock('pg', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn()
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
