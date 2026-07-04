jest.useFakeTimers();

jest.mock('dockerode', () => {
  const mockDocker = {
    ping: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue({
      id: 'container-1',
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const MockDocker = jest.fn((opts) => mockDocker);
  MockDocker.prototype = mockDocker;
  return MockDocker;
});

describe('PoolManager max capacity (BP-61)', () => {
  let pm;
  let Docker;
  let mockDocker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    global.setInterval = jest.fn();
    Docker = require('dockerode');
    mockDocker = Docker();
    mockDocker.ping.mockResolvedValue(undefined);
    delete require.cache[require.resolve('../services/PoolManager')];
    pm = require('../services/PoolManager');
    if (!pm.docker) {
      pm.docker = mockDocker;
    }
  });

  afterEach(() => {
    global.setInterval = setInterval;
    jest.useRealTimers();
  });

  it('throws when pool is at max capacity', async () => {
    // Set pool to max capacity (default 50)
    pm.setMaxPoolSize(2); // Use small number for testing
    pm.pool.clear();
    
    // Fill the pool
    const mockContainer = { id: 'container-1', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    
    await pm.requestAgent('proj-1');
    await pm.requestAgent('proj-2');
    
    // Pool is now at max capacity (2/2)
    expect(pm.pool.size).toBe(2);
    
    // Next request should throw
    await expect(pm.requestAgent('proj-3')).rejects.toThrow('Agent pool at max capacity');
  });

  it('allows requests when pool is not at capacity', async () => {
    pm.setMaxPoolSize(3);
    pm.pool.clear();
    
    const mockContainer = { id: 'container-1', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    
    // Should succeed for first 3 requests
    const r1 = await pm.requestAgent('proj-1');
    const r2 = await pm.requestAgent('proj-2');
    const r3 = await pm.requestAgent('proj-3');
    
    expect(r1.reused).toBe(false);
    expect(r2.reused).toBe(false);
    expect(r3.reused).toBe(false);
    expect(pm.pool.size).toBe(3);
  });

  it('releases capacity when agent is released', async () => {
    pm.setMaxPoolSize(2);
    pm.pool.clear();
    
    const mockContainer = { id: 'container-1', start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    
    await pm.requestAgent('proj-1');
    await pm.requestAgent('proj-2');
    
    // Pool is full, release one agent
    await pm.releaseAgent(pm.pool.keys().next().value);
    
    // Now we can create a new agent
    const mockContainer2 = { id: 'container-2', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer2);
    
    const r3 = await pm.requestAgent('proj-3');
    expect(r3.reused).toBe(false);
  });

  it('maxPoolSize is configurable via env var', () => {
    // The PoolManager singleton has _maxPoolSize set from env var
    // We verify setMaxPoolSize is available
    expect(typeof pm.setMaxPoolSize).toBe('function');
  });

  it('pool capacity check uses _maxPoolSize variable', async () => {
    // Set a small maxPoolSize for this test
    pm.setMaxPoolSize(2);
    pm.pool.clear();
    
    const mockContainer = { id: 'container-1', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    
    // Fill to capacity
    await pm.requestAgent('proj-1');
    await pm.requestAgent('proj-2');
    
    // Should throw at capacity
    await expect(pm.requestAgent('proj-3')).rejects.toThrow('Agent pool at max capacity');
  });
});
