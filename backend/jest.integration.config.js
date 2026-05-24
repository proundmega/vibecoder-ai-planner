process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/vibecode';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__'],
  testMatch: ['**/integration/**/*.test.js', '**/docker.test.js'],
  coverageDirectory: '../../coverage/backend-integration',
  moduleDirectories: ['node_modules', '<rootDir>'],
  moduleNameMapper: {
    '^models/(.*)$': '<rootDir>/src/models/$1',
    '^services/(.*)$': '<rootDir>/src/services/$1',
  },
  verbose: true,
  forceExit: true,
  restoreMocks: false,
  watchPathIgnorePatterns: ['/node_modules/', '/coverage/'],
  testTimeout: 30000,
  setupFilesAfterEnv: [],
};