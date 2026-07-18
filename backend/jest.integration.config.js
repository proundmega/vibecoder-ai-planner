require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:changeme@localhost:5432/vibecode';
process.env.NODE_ENV = 'test';
process.env.INTEGRATION_TESTS = '1';

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
  // forceExit removed — Jest exits cleanly with afterAll hooks
  restoreMocks: false,
  watchPathIgnorePatterns: ['/node_modules/', '/coverage/'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.js'],
  maxWorkers: 1,
};