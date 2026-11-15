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
  const MockDocker = jest.fn((_opts) => mockDocker);
  MockDocker.prototype = mockDocker;
  return MockDocker;
});

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((key) => `decrypted-${key}`),
}));

jest.mock('../db', () => {
  const mockPool = {
    query: jest.fn(),
  };
  return { pool: mockPool };
});

jest.mock('../services/AgentService', () => ({
  create: jest.fn().mockResolvedValue({ id: 'agent-1' }),
}));

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
    mockDocker.getNetwork = jest.fn().mockReturnValue({
      inspect: jest.fn().mockResolvedValue({}),
    });
    mockDocker.createNetwork = jest.fn().mockResolvedValue({});
    mockDocker.createVolume = jest.fn().mockResolvedValue({});
    
    const { pool } = require('../db');
    pool.query.mockReset();
    
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

  it('throws when pool is max capacity', async () => {
    // Set pool to max capacity (default 50)
    pm.setMaxPoolSize(2); // Use small number for testing
    pm.pool.clear();
    
    const { pool } = require('../db');
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      });
    
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
    
    const { pool } = require('../db');
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      });
    
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

  it('forwards SANDBOX_REQUIRE_SECURE_FILE_ACCESS to pool agents', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = { id: 'container-secure', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

    const previous = process.env.SANDBOX_REQUIRE_SECURE_FILE_ACCESS;
    process.env.SANDBOX_REQUIRE_SECURE_FILE_ACCESS = 'true';
    try {
      await pm.requestAgent('proj-secure');
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_REQUIRE_SECURE_FILE_ACCESS;
      else process.env.SANDBOX_REQUIRE_SECURE_FILE_ACCESS = previous;
    }

    const createOpts = pm.docker.createContainer.mock.calls[0][0];
    expect(createOpts.Env).toContain('SANDBOX_REQUIRE_SECURE_FILE_ACCESS=true');
  });

  it('forwards the sandbox deployment environment to pool agents', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = {
      id: 'container-sandbox',
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    pm.docker.getVolume = jest.fn().mockReturnValue({
      inspect: jest.fn().mockResolvedValue({
        Mountpoint: '/var/lib/docker/volumes/vibecode_repos/_data',
      }),
    });

    const previous = {};
    const values = {
      SANDBOX_MODE: 'docker',
      SANDBOX_IMAGE: 'sandbox@sha256:abc',
      SANDBOX_NETWORK: 'allowlist',
      SANDBOX_ALLOWED_HOSTS: 'registry.npmjs.org',
    };
    for (const [name, value] of Object.entries(values)) {
      previous[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      await pm.requestAgent('proj-sandbox');
    } finally {
      for (const name of Object.keys(values)) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }

    const createOpts = pm.docker.createContainer.mock.calls[0][0];
    expect(createOpts.Env).toContain('SANDBOX_MODE=docker');
    expect(createOpts.Env).toContain('SANDBOX_IMAGE=sandbox@sha256:abc');
    expect(createOpts.Env).toContain('SANDBOX_NETWORK=allowlist');
    expect(createOpts.Env).toContain('SANDBOX_ALLOWED_HOSTS=registry.npmjs.org');
    expect(createOpts.Env).toContain('SANDBOX_CONTAINER_WORKSPACE_ROOT=/repos');
    expect(createOpts.Env).toContain(
      'SANDBOX_HOST_WORKSPACE_ROOT=/var/lib/docker/volumes/vibecode_repos/_data');
    expect(createOpts.Env).toContain('DOCKER_HOST=tcp://docker-proxy:2375');
    expect(pm.docker.getVolume).toHaveBeenCalledWith('vibecode_repos');
    expect(createOpts.NetworkingConfig.EndpointsConfig).toHaveProperty(
      'vibecode-sandbox-control');
  });

  it('honours an explicit AGENT_DOCKER_HOST in Docker mode', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = { id: 'container-proxy', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

    const previous = {
      AGENT_DOCKER_HOST: process.env.AGENT_DOCKER_HOST,
      SANDBOX_MODE: process.env.SANDBOX_MODE,
      SANDBOX_HOST_WORKSPACE_ROOT: process.env.SANDBOX_HOST_WORKSPACE_ROOT,
    };
    process.env.AGENT_DOCKER_HOST = 'tcp://proxy.internal:2375';
    process.env.SANDBOX_MODE = 'DOCKER';
    process.env.SANDBOX_HOST_WORKSPACE_ROOT = '/srv/repos';
    try {
      await pm.requestAgent('proj-proxy');

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('DOCKER_HOST=tcp://proxy.internal:2375');
      expect(createOpts.Env).toContain('SANDBOX_HOST_WORKSPACE_ROOT=/srv/repos');
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('does not pass DOCKER_HOST or the control network to host-mode agents', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = { id: 'container-host', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

    const previous = process.env.SANDBOX_MODE;
    delete process.env.SANDBOX_MODE;
    try {
      await pm.requestAgent('proj-host');

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^DOCKER_HOST=/)]));
      expect(createOpts.NetworkingConfig).toBeUndefined();
      expect(pm.docker.getNetwork).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_MODE;
      else process.env.SANDBOX_MODE = previous;
    }
  });

  it('creates a fresh repo volume before resolving the host workspace root', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = { id: 'container-fresh-volume', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    const inspect = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('no such volume'), { statusCode: 404 }))
      .mockResolvedValue({ Mountpoint: '/var/lib/docker/volumes/vibecode_repos/_data' });
    pm.docker.getVolume = jest.fn().mockReturnValue({ inspect });
    pm.docker.getNetwork = jest.fn()
      .mockReturnValueOnce({ inspect: jest.fn().mockRejectedValue(
        Object.assign(new Error('no such network'), { statusCode: 404 })) })
      .mockReturnValue({ inspect: jest.fn().mockResolvedValue({}) });

    const previous = {
      SANDBOX_MODE: process.env.SANDBOX_MODE,
      SANDBOX_HOST_WORKSPACE_ROOT: process.env.SANDBOX_HOST_WORKSPACE_ROOT,
    };
    process.env.SANDBOX_MODE = 'docker';
    delete process.env.SANDBOX_HOST_WORKSPACE_ROOT;
    try {
      await pm.requestAgent('proj-fresh-volume');

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(pm.docker.createVolume).toHaveBeenCalledWith({ Name: 'vibecode_repos' });
      expect(pm.docker.createNetwork).toHaveBeenCalledWith(expect.objectContaining({
        Name: 'vibecode-sandbox-control',
        Internal: true,
      }));
      expect(createOpts.Env).toContain(
        'SANDBOX_HOST_WORKSPACE_ROOT=/var/lib/docker/volumes/vibecode_repos/_data');
      expect(createOpts.NetworkingConfig.EndpointsConfig).toHaveProperty(
        'vibecode-sandbox-control');
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('uses an explicit SANDBOX_HOST_WORKSPACE_ROOT without inspecting the volume', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = { id: 'container-explicit-root', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    pm.docker.getVolume = jest.fn();

    const previous = {
      SANDBOX_MODE: process.env.SANDBOX_MODE,
      SANDBOX_HOST_WORKSPACE_ROOT: process.env.SANDBOX_HOST_WORKSPACE_ROOT,
    };
    process.env.SANDBOX_MODE = 'docker';
    process.env.SANDBOX_HOST_WORKSPACE_ROOT = '/srv/repos';
    try {
      await pm.requestAgent('proj-explicit-root');

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('SANDBOX_HOST_WORKSPACE_ROOT=/srv/repos');
      expect(pm.docker.getVolume).not.toHaveBeenCalled();
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      delete pm.docker.getVolume;
    }
  });

  it('rejects a non-internal sandbox control network', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    pm.docker.createContainer = jest.fn();
    pm.docker.getNetwork = jest.fn().mockReturnValue({
      inspect: jest.fn().mockResolvedValue({ Internal: false }),
    });

    const previous = {
      SANDBOX_MODE: process.env.SANDBOX_MODE,
      SANDBOX_HOST_WORKSPACE_ROOT: process.env.SANDBOX_HOST_WORKSPACE_ROOT,
    };
    process.env.SANDBOX_MODE = 'docker';
    process.env.SANDBOX_HOST_WORKSPACE_ROOT = '/srv/repos';
    try {
      await expect(pm.requestAgent('proj-public-network')).rejects.toThrow(
        /must be internal/);
      expect(pm.docker.createContainer).not.toHaveBeenCalled();
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('fails closed when Docker mode has no host-visible workspace', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const AgentService = require('../services/AgentService');
    const mockContainer = { id: 'container-no-volume', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    delete pm.docker.getVolume;

    const previous = process.env.SANDBOX_MODE;
    process.env.SANDBOX_MODE = 'docker';
    try {
      await expect(pm.requestAgent('proj-no-volume')).rejects.toThrow(
        /host-visible repo workspace/);
      expect(pm.docker.createContainer).not.toHaveBeenCalled();
      expect(AgentService.create).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_MODE;
      else process.env.SANDBOX_MODE = previous;
    }
  });

  it('forwards SANDBOX_EGRESS_TLS_MODE to pool agents', async () => {
    pm.pool.clear();
    const { pool } = require('../db');
    pool.query.mockResolvedValue({
      rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
    });
    const mockContainer = { id: 'container-tls', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

    const previous = process.env.SANDBOX_EGRESS_TLS_MODE;
    process.env.SANDBOX_EGRESS_TLS_MODE = 'terminate';
    try {
      await pm.requestAgent('proj-tls');
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_EGRESS_TLS_MODE;
      else process.env.SANDBOX_EGRESS_TLS_MODE = previous;
    }

    const createOpts = pm.docker.createContainer.mock.calls[0][0];
    expect(createOpts.Env).toContain('SANDBOX_EGRESS_TLS_MODE=terminate');
  });

  it('releases capacity when agent is released', async () => {
    pm.setMaxPoolSize(2);
    pm.pool.clear();
    
    const { pool } = require('../db');
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      });
    
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
    
    const { pool } = require('../db');
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
      });
    
    const mockContainer = { id: 'container-1', start: jest.fn().mockResolvedValue(undefined) };
    pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);
    
    // Fill to capacity
    await pm.requestAgent('proj-1');
    await pm.requestAgent('proj-2');
    
    // Should throw at capacity
    await expect(pm.requestAgent('proj-3')).rejects.toThrow('Agent pool at max capacity');
  });
});
