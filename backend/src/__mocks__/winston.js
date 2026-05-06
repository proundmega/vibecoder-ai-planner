module.exports = function() {
  return {
    createLogger: jest.fn(() => ({
      level: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      format: {
        combine: jest.fn(() => ({
          timestamp: jest.fn(() => ({
            json: jest.fn(() => {})
          })),
          colorize: jest.fn(() => ({ all: true })),
          simple: jest.fn(() => ({ all: true }))
        })),
        timestamp: jest.fn().mockImplementation((fn) => fn),
        json: jest.fn().mockImplementation(() => ({})),
        colorize: jest.fn().mockImplementation(() => ({})),
        simple: jest.fn().mockImplementation(() => ({}))
      },
      transports: [
        { level: jest.fn(), name: 'console', format: jest.fn(), write: jest.fn() }
      ],
      exit: jest.fn(),
      exitOnError: false
    }))
  };
};
