jest.useFakeTimers();

const mockDockerObj = {
  ping: jest.fn().mockResolvedValue(undefined),
  createContainer: jest.fn().mockResolvedValue({
    id: 'container-1',
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  }),
};

jest.mock('../utils/docker', () => ({
  docker: mockDockerObj,
  DOCKER_URL: 'http://docker-proxy:2375',
}));

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

let dockerModule;

describe('PoolManager', () => {
  let pm;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    global.setInterval = jest.fn(); // Prevent actual intervals
    mockDockerObj.ping.mockResolvedValue(undefined);
    dockerModule = require('../utils/docker');
    
    // Clear require cache to get a fresh instance with mocked docker
    delete require.cache[require.resolve('../services/PoolManager')];
    pm = require('../services/PoolManager');
    // Ensure docker is set (constructor may set it to null if ping fails)
    if (!pm.docker) {
      pm.docker = mockDockerObj;
    }
    // Reset pool and max pool size for clean state
    pm.pool.clear();
    pm.setMaxPoolSize(50);
  });

  afterEach(() => {
    global.setInterval = setInterval;
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('initializes docker client', () => {
      expect(pm.docker.ping).toHaveBeenCalled();
    });
  });

  describe('requestAgent', () => {
    it('reuses idle agent when available', () => {
      pm.pool.set('agent-1', { state: 'idle', containerId: 'c1' });

      return pm.requestAgent('proj-1').then((res) => {
        expect(res.reused).toBe(true);
        expect(res.agentId).toBe('agent-1');
        const entry = pm.pool.get('agent-1');
        expect(entry.state).toBe('busy');
        expect(entry.projectId).toBe('proj-1');
      });
    });

    it('creates new container when no idle agents', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      const { pool } = require('../db');
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
        });

      const result = await pm.requestAgent('proj-1', 'https://github.com/repo');

      expect(result.reused).toBe(false);
      expect(result.agentId).toBeDefined();
      expect(result.containerId).toBe('new-container-1');
      expect(pm.docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: expect.any(String),
          Env: expect.arrayContaining([
            expect.stringContaining('BACKEND_URL='),
            expect.stringContaining('AI_PROVIDER='),
            expect.stringContaining('AI_MODEL='),
            expect.stringContaining('AI_API_KEY='),
            expect.stringContaining('AI_MAX_TOKENS='),
          ]),
        })
      );
      expect(mockContainer.start).toHaveBeenCalled();
    });

    it('throws when docker is not available', async () => {
      pm.docker = null;

      await expect(pm.requestAgent('proj-1')).rejects.toThrow('Docker daemon not available');
    });

    it('throws when pool is at max capacity', async () => {
      const mockContainer = { id: 'c1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

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

      // Clear pool and set max pool size to 3 for this test
      pm.pool.clear();
      pm.setMaxPoolSize(3);

      // Fill pool to max
      await pm.requestAgent('proj-1');
      await pm.requestAgent('proj-2');
      await pm.requestAgent('proj-3');

      // Next request should throw
      await expect(pm.requestAgent('proj-4')).rejects.toThrow(/max capacity/);

      // Reset to default
      pm.pool.clear();
      pm.setMaxPoolSize(50);
    });

    it('includes provider config env vars (legacy format)', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      await pm.requestAgent('proj-1', 'https://github.com/repo', {
        endpoint: 'https://api.custom.com',
        apiKey: 'custom-key',
        model: 'gpt-4',
      });

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('AI_ENDPOINT_URL=https://api.custom.com');
      expect(createOpts.Env).toContain('AI_API_KEY=custom-key');
      expect(createOpts.Env).toContain('AI_MODEL=gpt-4');
      expect(createOpts.Env).toContain('AI_PROVIDER=generic');
      expect(createOpts.Env).toContain('AI_MAX_TOKENS=4096');
    });

    it('throws helpful error for missing image', async () => {
      pm.docker.createContainer = jest.fn().mockRejectedValue(new Error('No such image: vibecode-agent'));

      const { pool } = require('../db');
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
        });

      await expect(pm.requestAgent('proj-1')).rejects.toThrow("Agent image 'vibecode-agent' not found");
    });
  });

  describe('releaseAgent', () => {
    it('destroys container and removes from pool', async () => {
      const mockContainer = { stop: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) };
      pm.pool.set('agent-1', { state: 'busy', containerId: 'c1', container: mockContainer });

      await pm.releaseAgent('agent-1');

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 5 });
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
      expect(pm.pool.has('agent-1')).toBe(false);
    });

    it('throws when agent not found', async () => {
      await expect(pm.releaseAgent('nonexistent')).rejects.toThrow('Agent nonexistent not found in pool');
    });
  });

  describe('getStatus', () => {
    it('returns agent list and stats', () => {
      pm.pool.clear();
      pm.pool.set('agent-1', { state: 'busy', containerId: 'c1', ticketId: 't1', projectId: 'p1', startedAt: Date.now(), lastActiveAt: Date.now() });
      pm.pool.set('agent-2', { state: 'idle', containerId: 'c2', ticketId: null, projectId: 'p2', startedAt: Date.now() - 60000, lastActiveAt: Date.now() });
      pm.pool.set('agent-3', { state: 'starting', containerId: 'c3', ticketId: null, projectId: 'p3', startedAt: Date.now(), lastActiveAt: Date.now() });

      const result = pm.getStatus();

      expect(result.stats).toEqual({ total: 3, busy: 1, idle: 1, starting: 1 });
      expect(result.agents.length).toBe(3);
      expect(result.agents[0].agentId).toBe('agent-1');
      expect(result.agents[0].state).toBe('busy');
    });

    it('returns empty when no agents', () => {
      pm.pool.clear();
      const result = pm.getStatus();

      expect(result.stats).toEqual({ total: 0, busy: 0, idle: 0, starting: 0 });
      expect(result.agents).toEqual([]);
    });
  });

  describe('markActive', () => {
    it('transitions starting->busy', () => {
      pm.pool.set('agent-1', { state: 'starting', startedAt: Date.now() });
      pm.markActive('agent-1');

      const entry = pm.pool.get('agent-1');
      expect(entry.state).toBe('busy');
    });

    it('does not change busy state', () => {
      pm.pool.set('agent-1', { state: 'busy', startedAt: Date.now() });
      pm.markActive('agent-1');

      expect(pm.pool.get('agent-1').state).toBe('busy');
    });

    it('does nothing for missing agent', () => {
      pm.markActive('nonexistent');
    });
  });

  describe('markIdle', () => {
    it('sets state to idle and clears ticketId', () => {
      pm.pool.set('agent-1', { state: 'busy', ticketId: 't1', startedAt: Date.now() });
      pm.markIdle('agent-1');

      const entry = pm.pool.get('agent-1');
      expect(entry.state).toBe('idle');
      expect(entry.ticketId).toBeNull();
    });

    it('does nothing for missing agent', () => {
      pm.markIdle('nonexistent');
    });
  });

  describe('resolveProviderConfig', () => {
    it('returns decrypted provider config', async () => {
      const { pool } = require('../db');
      pool.query.mockReset();
      pool.query.mockResolvedValueOnce({
        rows: [{
          provider_type: 'claude',
          api_key_encrypted: 'encrypted-key-123',
          base_url: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          temperature: 0.1,
        }],
      });

      const config = await pm.resolveProviderConfig('provider-1');

      expect(config.provider_type).toBe('claude');
      expect(config.api_key).toBe('decrypted-encrypted-key-123');
      expect(config.base_url).toBe('https://api.anthropic.com');
      expect(config.model).toBe('claude-sonnet-4-20250514');
      expect(config.max_tokens).toBe(8192);
    });

    it('throws when provider not found', async () => {
      const { pool } = require('../db');
      pool.query.mockReset();
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(pm.resolveProviderConfig('nonexistent')).rejects.toThrow('Provider not found or inactive');
    });
  });

  describe('autoSelectProvider', () => {
    it('selects worker provider first', async () => {
      const { pool } = require('../db');
      pool.query.mockReset();
      pool.query.mockResolvedValueOnce({
        rows: [{ provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 8192 }],
      });

      const config = await pm.autoSelectProvider();

      expect(config.provider_type).toBe('claude');
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('falls back to any active provider', async () => {
      const { pool } = require('../db');
      pool.query.mockReset();
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ provider_type: 'openai', api_key_encrypted: 'enc2', base_url: 'https://api.openai.com', model: 'gpt-4', max_tokens: 4096 }],
        });

      const config = await pm.autoSelectProvider();

      expect(config.provider_type).toBe('openai');
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('throws when no providers exist', async () => {
      const { pool } = require('../db');
      pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

      await expect(pm.autoSelectProvider()).rejects.toThrow('No active providers configured');
    });
  });

  describe('requestAgent with provider resolution', () => {
    it('passes all provider env vars when providerId is specified', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      const { pool } = require('../db');
      pool.query.mockReset();
      pool.query.mockResolvedValueOnce({
        rows: [{
          provider_type: 'claude',
          api_key_encrypted: 'encrypted-key',
          base_url: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          temperature: 0.1,
        }],
      });

      await pm.requestAgent('proj-1', 'https://github.com/repo', { providerId: 'provider-1' });

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('AI_PROVIDER=claude');
      expect(createOpts.Env).toContain('AI_MODEL=claude-sonnet-4-20250514');
      expect(createOpts.Env).toContain('AI_API_KEY=decrypted-encrypted-key');
      expect(createOpts.Env).toContain('AI_MAX_TOKENS=8192');
      expect(createOpts.Env).toContain('AI_ENDPOINT_URL=https://api.anthropic.com');
    });

    it('auto-selects provider when no provider specified', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      const { pool } = require('../db');
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'worker-1', provider_type: 'claude', api_key_encrypted: 'enc1', base_url: 'https://api.com', model: 'claude-sonnet-4-20250514', max_tokens: 4096 }],
        });

      await pm.requestAgent('proj-1', 'https://github.com/repo', {});

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('AI_PROVIDER=claude');
      expect(createOpts.Env).toContain('AI_MODEL=claude-sonnet-4-20250514');
      expect(createOpts.Env).toContain('AI_MAX_TOKENS=4096');
    });

    it('supports legacy provider_config format', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      await pm.requestAgent('proj-1', 'https://github.com/repo', {
        endpoint: 'https://api.custom.com',
        apiKey: 'custom-key',
        model: 'gpt-4',
      });

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('AI_PROVIDER=generic');
      expect(createOpts.Env).toContain('AI_MODEL=gpt-4');
      expect(createOpts.Env).toContain('AI_API_KEY=custom-key');
      expect(createOpts.Env).toContain('AI_ENDPOINT_URL=https://api.custom.com');
      expect(createOpts.Env).toContain('AI_MAX_TOKENS=4096');
    });

    it('includes AI_PROVIDER and AI_MAX_TOKENS in all cases', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      const { pool } = require('../db');
      pool.query.mockReset();
      pool.query.mockResolvedValueOnce({
        rows: [{
          provider_type: 'openai',
          api_key_encrypted: 'enc',
          base_url: null,
          model: 'gpt-4',
          max_tokens: 4096,
          temperature: 0.1,
        }],
      });

      await pm.requestAgent('proj-1', 'https://github.com/repo', { providerId: 'provider-1' });

      const createOpts = pm.docker.createContainer.mock.calls[0][0];
      expect(createOpts.Env).toContain('AI_PROVIDER=openai');
      expect(createOpts.Env).toContain('AI_MAX_TOKENS=4096');
      expect(createOpts.Env).not.toContain('AI_ENDPOINT_URL=');
    });
  });
});
