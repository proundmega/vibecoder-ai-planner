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
