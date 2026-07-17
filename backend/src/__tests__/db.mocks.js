// Mock files for db.js and model files
// These mocks allow unit testing without actual database connections

// Mock db.js
jest.mock('../db', () => {
  const MockPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    on: jest.fn(),
    end: jest.fn(),
  };
  
  return {
    pool: MockPool,
    connect: jest.fn().mockResolvedValue(true),
    MockPool,
  };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-' + Date.now()),
  v4Array: jest.fn().mockImplementation(() => Array(32).fill(0).map(() => Math.random().toString(36).substring(2, 5).toLowerCase()))
}));

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  hash: jest.fn((_str, _salt) => Promise.resolve('$2b$10$' + Array(48).fill('0').join(''))),
  compare: jest.fn((_str, _hash) => Promise.resolve(_str === 'test123')),
  genSalt: jest.fn(() => Promise.resolve('$2b$10$'))
}));

// Mock fs for migrations
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readdirSync: jest.fn().mockReturnValue(['seed.sql']),
  readFileSync: jest.fn().mockReturnValue(''),
}));

// Mock path
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...paths) => paths.join('/')),
}));
