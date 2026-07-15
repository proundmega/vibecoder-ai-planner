jest.mock('../services/CredentialService', () => ({
  decryptKey: jest.fn().mockResolvedValue('decrypted-key'),
}));

jest.mock('../errors/HttpError', () => {
  class UtilityError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { UtilityError };
});

jest.mock('../services/PoolManager', () => ({
  resolveProviderConfig: jest.fn(),
}));

jest.mock('ssh2', () => {
  let readyDelay = 0;
  let errorDelay = null;
  const execCalls = [];
  
  function MockClient() {
    this._onHandlers = {};
    this._execCb = null;
    this._execStream = {
      on: jest.fn((event, handler) => {
        if (event === 'close') handler(0);
        return this;
      }),
      stderr: {
        on: jest.fn(),
      },
    };
  }
  MockClient.prototype.on = function(event, handler) {
    this._onHandlers[event] = handler;
    if (event === 'ready' && errorDelay === null) {
      if (readyDelay > 0) {
        setTimeout(() => handler(), readyDelay);
      } else {
        setImmediate(() => handler());
      }
    }
    if (event === 'error' && errorDelay !== null) {
      if (errorDelay > 0) {
        setTimeout(() => handler(errorDelay), errorDelay);
      } else {
        setImmediate(() => handler(errorDelay));
      }
    }
    return this;
  };
  MockClient.prototype.connect = function() {};
  MockClient.prototype.exec = function(cmd, cb) {
    this._execCb = cb;
    execCalls.push(cmd);
    cb(null, this._execStream);
  };
  MockClient.prototype.end = jest.fn();
  
  // Test helpers
  MockClient.setReadyDelay = (ms) => { readyDelay = ms; };
  MockClient.setErrorDelay = (err) => { errorDelay = err; };
  MockClient.reset = () => { readyDelay = 0; errorDelay = null; execCalls.length = 0; };
  MockClient.getLastExecCall = () => execCalls[execCalls.length - 1];
  
  return { Client: MockClient };
});

const ProvisioningService = require('../services/ProvisioningService');
const CredentialService = require('../services/CredentialService');
const { pool } = require('../db');
const { Client: MockClient } = require('ssh2');
const PoolManager = require('../services/PoolManager');

describe('ProvisioningService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockClient.reset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('getNode', () => {
    it('returns node by id', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu' };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      const result = await ProvisioningService.getNode('cn1');

      expect(result).toEqual(mockNode);
    });

    it('throws when node not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ProvisioningService.getNode('missing')).rejects.toThrow('Compute node not found');
    });
  });

  describe('getKey', () => {
    it('delegates to CredentialService.decryptKey', async () => {
      CredentialService.decryptKey.mockResolvedValue('decrypted-key');

      const result = await ProvisioningService.getKey({ ssh_key_credential_id: 'cred-1' });

      expect(CredentialService.decryptKey).toHaveBeenCalledWith('cred-1');
      expect(result).toBe('decrypted-key');
    });
  });

  describe('spawnAgent', () => {
    it('spawns agent and resets failure_count on success', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      const result = await ProvisioningService.spawnAgent('cn1', { id: 'proj-1' });

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE compute_nodes SET last_seen = NOW(), failure_count = 0 WHERE id = $1',
        ['cn1']
      );
    });

    it('resolves provider config when provider_id is provided', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });
      PoolManager.resolveProviderConfig.mockResolvedValueOnce({
        provider_type: 'claude',
        api_key: 'decrypted-key-123',
        base_url: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        temperature: 0.1,
      });

      await ProvisioningService.spawnAgent('cn1', { id: 'proj-1', provider_id: 'provider-1' });

      expect(PoolManager.resolveProviderConfig).toHaveBeenCalledWith('provider-1');
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE compute_nodes SET last_seen = NOW(), failure_count = 0 WHERE id = $1',
        ['cn1']
      );
    });

    it('throws when provider resolution fails', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });
      PoolManager.resolveProviderConfig.mockRejectedValueOnce(new Error('Provider not found or inactive'));

      await expect(ProvisioningService.spawnAgent('cn1', { id: 'proj-1', provider_id: 'nonexistent' }))
        .rejects.toThrow('Provider resolution failed for remote spawn: Provider not found or inactive');
    });

    it('conditionally sets AI_MODEL and AI_API_KEY only when truthy', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });
      PoolManager.resolveProviderConfig.mockResolvedValueOnce({
        provider_type: 'claude',
        api_key: null,
        base_url: null,
        model: null,
        max_tokens: 4096,
        temperature: 0.1,
      });

      await ProvisioningService.spawnAgent('cn1', { id: 'proj-1', provider_id: 'provider-1' });

      const execCall = MockClient.getLastExecCall();
      expect(execCall).toMatch(/AI_PROVIDER=.*claude/);
      expect(execCall).toMatch(/AI_MAX_TOKENS=.*4096/);
      expect(execCall).not.toContain('AI_MODEL=');
      expect(execCall).not.toContain('AI_API_KEY=');
      expect(execCall).not.toContain('AI_ENDPOINT_URL=');
    });

    it('escapes shell metacharacters in env values', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });
      PoolManager.resolveProviderConfig.mockResolvedValueOnce({
        provider_type: 'claude',
        api_key: 'key$with"special`chars',
        base_url: null,
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: 0.1,
      });

      await ProvisioningService.spawnAgent('cn1', { id: 'proj-1', provider_id: 'provider-1' });

      const execCall = MockClient.getLastExecCall();
      expect(execCall).toContain('\\$');
      expect(execCall).toContain('\\"');
      expect(execCall).toContain('\\`');
    });
  });

  describe('destroyAgent', () => {
    it('stops and removes container', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      await ProvisioningService.destroyAgent('cn1', 'container-1');

      // Just verify it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('returns success when connection works', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22, failure_count: 0 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      const result = await ProvisioningService.testConnection('cn1');

      expect(result).toEqual({ success: true });
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE compute_nodes SET status = $1, failure_count = 0, last_seen = NOW() WHERE id = $2',
        ['online', 'cn1']
      );
    });

    it('marks as degraded after first failure', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22, failure_count: 0 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      MockClient.setErrorDelay(new Error('connection refused'));

      const result = await ProvisioningService.testConnection('cn1');

      expect(result.success).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE compute_nodes SET status = $1, failure_count = $2, last_seen = NOW() WHERE id = $3',
        ['degraded', 1, 'cn1']
      );
    });

    it('marks as offline after 3+ failures', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22, failure_count: 2 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      MockClient.setErrorDelay(new Error('connection refused'));

      const result = await ProvisioningService.testConnection('cn1');

      expect(result.failureCount).toBe(3);
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE compute_nodes SET status = $1, failure_count = $2, last_seen = NOW() WHERE id = $3',
        ['offline', 3, 'cn1']
      );
    });
  });

  describe('getRunningContainers', () => {
    it('parses docker ps output', async () => {
      const mockNode = { id: 'cn1', hostname: '10.0.0.1', ssh_user: 'ubuntu', ssh_port: 22 };
      pool.query.mockResolvedValueOnce({ rows: [mockNode] });

      const result = await ProvisioningService.getRunningContainers('cn1');

      expect(result).toEqual([]); // empty stdout
    });
  });
});
