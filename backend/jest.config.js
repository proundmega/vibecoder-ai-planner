module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.js'],
  coverageDirectory: '../../coverage/backend',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/jest.setup.js'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  moduleNameMapper: {},
  verbose: true,
  forceExit: true,
  restoreMocks: false,
  watchPathIgnorePatterns: ['/node_modules/', '/coverage/'],
  testTimeout: 10000,
  testPathIgnorePatterns: ['/node_modules/']
};
