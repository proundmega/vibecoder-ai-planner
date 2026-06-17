const mockPool = {
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
  query: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
  stats: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

describe('Database Pool Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('should create pool with correct defaults', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.DATABASE_IDLE_TIMEOUT_MS;
    delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
    delete process.env.DATABASE_MAX_USES;

    require('../db');

    const { Pool } = require('pg');
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      maxUses: 10000,
    }));
  });

  it('should use env var for DATABASE_POOL_MAX', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.DATABASE_POOL_MAX = '50';

    require('../db');

    const { Pool } = require('pg');
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      max: 50,
    }));
  });

  it('should use env var for DATABASE_IDLE_TIMEOUT_MS', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.DATABASE_IDLE_TIMEOUT_MS = '60000';

    require('../db');

    const { Pool } = require('pg');
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      idleTimeoutMillis: 60000,
    }));
  });

  it('should use env var for DATABASE_CONNECTION_TIMEOUT_MS', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = '10000';

    require('../db');

    const { Pool } = require('pg');
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeoutMillis: 10000,
    }));
  });

  it('should use env var for DATABASE_MAX_USES', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.DATABASE_MAX_USES = '5000';

    require('../db');

    const { Pool } = require('pg');
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      maxUses: 5000,
    }));
  });

  it('should attach error handler to pool', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    require('../db');

    expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should attach stats method to pool', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    require('../db');

    expect(mockPool.stats).toBeDefined();
    expect(typeof mockPool.stats).toBe('function');
  });

  it('should return correct stats from pool.stats()', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

    require('../db');

    const stats = mockPool.stats();
    expect(stats).toEqual({
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    });
  });

  it('should handle waitingCount being undefined', () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    mockPool.waitingCount = undefined;

    require('../db');

    const stats = mockPool.stats();
    expect(stats.waitingCount).toBe(0);
  });
});
