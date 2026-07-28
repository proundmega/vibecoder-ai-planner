const ProviderService = require('../services/ProviderService');
const { decrypt } = require('../utils/crypto');

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn(),
}));

describe('ProviderService', () => {
  const pool = require('../db').pool;

  beforeEach(() => {
    jest.clearAllMocks();
    decrypt.mockReturnValue('decrypted-mock-key');
  });

  describe('getProjectProviders', () => {
    it('returns providers for a project', async () => {
      const mockConfig = { id: 1, provider_type: 'openai', model: 'gpt-4', project_id: 'proj-1' };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.getProjectProviders('proj-1');

      expect(result).toEqual([mockConfig]);
    });

    it('returns global providers when no project match', async () => {
      const mockConfig = { id: 1, provider_type: 'openai', model: 'gpt-4', project_id: null };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.getProjectProviders('proj-1');

      expect(result).toEqual([mockConfig]);
    });

    it('returns empty array when no active providers', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await ProviderService.getProjectProviders('proj-1');

      expect(result).toEqual([]);
    });
  });

  describe('resolveProvider', () => {
    it('throws when no active provider config', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ProviderService.resolveProvider({}, 'proj-1')).rejects.toThrow('No active provider configuration found');
    });

    it('returns default provider when no routing rules', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        base_url: 'https://api.openai.com', api_key_encrypted: 'enc-key',
        max_tokens: 4096, temperature: 0.1, project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({ labels: [], priority: 'medium' }, 'proj-1');

      expect(result).toEqual({
        provider: 'openai',
        endpoint_url: 'https://api.openai.com',
        model: 'gpt-4',
        api_key: 'decrypted-mock-key',
        max_tokens: 4096,
        temperature: 0.1,
        is_fallback: false,
      });
    });

    it('returns default provider when rules array is empty', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        base_url: 'https://api.openai.com', api_key_encrypted: 'enc-key',
        routing_rules: { rules: [] },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({}, 'proj-1');

      expect(result.provider).toBe('openai');
    });

    it('matches rule by label (OR logic)', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['frontend'] }, provider: 'frontend-model' },
            { match: { labels: ['backend'] }, provider: 'backend-model' },
          ],
        },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({ labels: ['backend', 'urgent'] }, 'proj-1');

      expect(result.provider).toBe('backend-model');
    });

    it('matches rule by priority', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { priority: 'high' }, provider: 'expensive-model' },
            { match: { priority: 'low' }, provider: 'cheap-model' },
          ],
        },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({ priority: 'high' }, 'proj-1');

      expect(result.provider).toBe('expensive-model');
    });

    it('matches rule by combined label AND priority', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['frontend'], priority: 'high' }, provider: 'premium' },
            { match: { labels: ['frontend'], priority: 'low' }, provider: 'standard' },
          ],
        },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({ labels: ['frontend'], priority: 'high' }, 'proj-1');

      expect(result.provider).toBe('premium');
    });

    it('returns fallback when no rule matches', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['frontend'] }, provider: 'frontend-model' },
          ],
          fallback: { provider: 'fallback-model' },
        },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({ labels: ['backend'] }, 'proj-1');

      expect(result.provider).toBe('fallback-model');
      expect(result.is_fallback).toBe(true);
    });

    it('uses rule-level api_key when present', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['test'] }, provider: 'test-model', api_key: 'rule-key' },
          ],
        },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({ labels: ['test'] }, 'proj-1');

      expect(result.api_key).toBe('rule-key');
    });

    it('uses rule-level endpoint_url and model overrides', async () => {
      const mockConfig = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        base_url: 'https://api.openai.com', api_key_encrypted: 'enc-key',
        max_tokens: 4096, temperature: 0.1,
        routing_rules: {
          rules: [
            { match: {}, provider: 'custom', endpoint_url: 'https://custom.api', model: 'custom-model', max_tokens: 8192, temperature: 0.5 },
          ],
        },
        project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider({}, 'proj-1');

      expect(result.provider).toBe('custom');
      expect(result.endpoint_url).toBe('https://custom.api');
      expect(result.model).toBe('custom-model');
      expect(result.max_tokens).toBe(8192);
      expect(result.temperature).toBe(0.5);
    });
  });

  describe('_matches', () => {
    it('returns true when match is null', () => {
      const result = ProviderService._matches(null, new Set(['label']), 'high');
      expect(result).toBe(true);
    });

    it('returns true when match is undefined', () => {
      const result = ProviderService._matches(undefined, new Set(['label']), 'high');
      expect(result).toBe(true);
    });

    it('returns true when no label filter and no priority filter', () => {
      const result = ProviderService._matches({ labels: [], priority: undefined }, new Set(['label']), 'high');
      expect(result).toBe(true);
    });

    it('returns true when ticket has matching label', () => {
      const result = ProviderService._matches({ labels: ['frontend'] }, new Set(['frontend', 'backend']), 'high');
      expect(result).toBe(true);
    });

    it('returns false when ticket lacks required label', () => {
      const result = ProviderService._matches({ labels: ['frontend'] }, new Set(['backend']), 'high');
      expect(result).toBe(false);
    });

    it('returns false when priority mismatches', () => {
      const result = ProviderService._matches({ priority: 'high' }, new Set(['label']), 'low');
      expect(result).toBe(false);
    });

    it('returns true when both label and priority match', () => {
      const result = ProviderService._matches({ labels: ['frontend'], priority: 'high' }, new Set(['frontend']), 'high');
      expect(result).toBe(true);
    });
  });

  describe('_buildProviderConfig', () => {
    it('builds config with rule overrides', () => {
      const baseConfig = {
        provider_type: 'openai', base_url: 'https://api.openai.com',
        model: 'gpt-4', api_key_encrypted: 'enc-key',
        max_tokens: 4096, temperature: 0.1,
      };
      const ruleConfig = { provider: 'custom', endpoint_url: 'https://custom', model: 'custom-model' };

      const result = ProviderService._buildProviderConfig(baseConfig, ruleConfig, false);

      expect(result).toEqual({
        provider: 'custom',
        endpoint_url: 'https://custom',
        model: 'custom-model',
        api_key: 'decrypted-mock-key',
        max_tokens: 4096,
        temperature: 0.1,
        is_fallback: false,
      });
    });

    it('uses rule api_key when present', () => {
      const baseConfig = { provider_type: 'openai', model: 'gpt-4', api_key_encrypted: 'enc-key' };
      const ruleConfig = { api_key: 'rule-key' };

      const result = ProviderService._buildProviderConfig(baseConfig, ruleConfig, false);

      expect(result.api_key).toBe('rule-key');
    });

    it('uses default max_tokens and temperature when not specified', () => {
      const baseConfig = { provider_type: 'openai', model: 'gpt-4', api_key_encrypted: 'enc-key' };
      const ruleConfig = {};

      const result = ProviderService._buildProviderConfig(baseConfig, ruleConfig, false);

      expect(result.max_tokens).toBe(4096);
      expect(result.temperature).toBe(0.1);
    });

    it('uses rule temperature when specified', () => {
      const baseConfig = { provider_type: 'openai', model: 'gpt-4', api_key_encrypted: 'enc-key', temperature: 0.1 };
      const ruleConfig = { temperature: 0.7 };

      const result = ProviderService._buildProviderConfig(baseConfig, ruleConfig, false);

      expect(result.temperature).toBe(0.7);
    });
  });

  describe('resolveProvider - Multi-Provider', () => {
    it('checks project-scoped providers first', async () => {
      const globalProvider = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key', project_id: null,
      };
      const projectProvider = {
        id: 2, provider_type: 'claude', model: 'claude-sonnet',
        api_key_encrypted: 'enc-key2', project_id: 'proj-1',
      };
      pool.query.mockResolvedValueOnce({ rows: [projectProvider, globalProvider] });

      const result = await ProviderService.resolveProvider({}, 'proj-1');

      expect(result.provider).toBe('claude');
      expect(result.model).toBe('claude-sonnet');
    });

    it('falls back to global provider when no project match', async () => {
      const globalProvider = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key', project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [globalProvider] });

      const result = await ProviderService.resolveProvider({}, 'proj-1');

      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
    });

    it('returns correct providers for project', async () => {
      const projectAProvider = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key', project_id: 'proj-a',
      };
      const projectBProvider = {
        id: 2, provider_type: 'claude', model: 'claude-sonnet',
        api_key_encrypted: 'enc-key2', project_id: 'proj-b',
      };
      const globalProvider = {
        id: 3, provider_type: 'openai', model: 'gpt-3.5',
        api_key_encrypted: 'enc-key3', project_id: null,
      };
      pool.query.mockResolvedValueOnce({ rows: [projectAProvider, globalProvider] });

      const result = await ProviderService.getProjectProviders('proj-a');

      expect(result).toHaveLength(2);
      expect(result[0].project_id).toBe('proj-a');
      expect(result[1].project_id).toBeNull();
    });

    it('global provider works when no project-scoped providers exist', async () => {
      const globalProvider = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key', project_id: null,
      };
      const projectProvider = {
        id: 2, provider_type: 'claude', model: 'claude-sonnet',
        api_key_encrypted: 'enc-key2', project_id: 'proj-1',
        routing_rules: {
          rules: [{ match: { labels: ['frontend'] }, provider: 'frontend-model' }],
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [projectProvider, globalProvider] });

      const result = await ProviderService.resolveProvider({ labels: ['backend'] }, 'proj-1');

      expect(result.provider).toBe('openai');
    });

    it('providers ordered: project-scoped first, global last', async () => {
      const globalProvider = {
        id: 1, provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key', project_id: null,
      };
      const projectProvider = {
        id: 2, provider_type: 'claude', model: 'claude-sonnet',
        api_key_encrypted: 'enc-key2', project_id: 'proj-1',
      };
      pool.query.mockResolvedValueOnce({ rows: [projectProvider, globalProvider] });

      const providers = await ProviderService.getProjectProviders('proj-1');

      expect(providers[0].project_id).toBe('proj-1');
      expect(providers[1].project_id).toBeNull();
    });

    it('throws when empty providers list', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ProviderService.resolveProvider({}, 'proj-1')).rejects.toThrow('No active provider configuration found');
    });
  });
});
