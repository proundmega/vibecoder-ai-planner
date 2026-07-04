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

    it('throws when docker is not available', async () => {
      pm.docker = null;

      await expect(pm.requestAgent('proj-1')).rejects.toThrow('Docker daemon not available');
    });

    it('throws when pool is at max capacity', async () => {
      const mockContainer = { id: 'c1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

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

    it('creates new container when no idle agents', async () => {
      const mockContainer = { id: 'new-container-1', start: jest.fn().mockResolvedValue(undefined) };
      pm.docker.createContainer = jest.fn().mockResolvedValue(mockContainer);

      const result = await pm.requestAgent('proj-1');

      expect(result.reused).toBe(false);
      expect(result.agentId).toBeDefined();
      expect(result.containerId).toBe('new-container-1');
      expect(pm.docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: expect.any(String),
          Env: expect.arrayContaining([
            expect.stringContaining('BACKEND_URL='),
            expect.stringContaining('API_KEY='),
            expect.stringContaining('AGENT_ID='),
            expect.stringContaining('REPO_CLONE_DIR='),
          ]),
        })
      );
      expect(mockContainer.start).toHaveBeenCalled();
    });

    it('includes provider config env vars', async () => {
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
    });

    it('throws helpful error for missing image', async () => {
      pm.docker.createContainer = jest.fn().mockRejectedValue(new Error('No such image: vibecode-agent'));

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
});
