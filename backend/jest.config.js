module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/unit.test.js',
    '**/__tests__/*.test.js',
    '<rootDir>/src/middleware/*.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', 'integration', 'docker'],
  coverageDirectory: '../../coverage/backend',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/jest.setup.js'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  moduleNameMapper: {
    '^models/(.*)$': '<rootDir>/src/models/$1',
    '^services/(.*)$': '<rootDir>/src/services/$1',
  },
  verbose: true,
  forceExit: true,
  restoreMocks: true,
  watchPathIgnorePatterns: ['/node_modules/', '/coverage/'],
  testTimeout: 10000,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/index.js',
    '!src/__tests__/*.{js,ts}',
    '!src/__mocks__/*',
    '!src/migrations/*',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
};
