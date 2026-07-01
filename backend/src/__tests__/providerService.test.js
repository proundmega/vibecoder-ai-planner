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

  describe('getProjectProvider', () => {
    it('returns active provider config for project', async () => {
      const mockConfig = { id: 'pp1', project_id: 1, provider_type: 'openai', model: 'gpt-4' };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.getProjectProvider(1);

      expect(result).toEqual(mockConfig);
    });

    it('returns null when no active config', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await ProviderService.getProjectProvider(999);

      expect(result).toBeNull();
    });
  });

  describe('resolveProvider', () => {
    it('throws when no active provider config', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ProviderService.resolveProvider(1, {})).rejects.toThrow('No active provider configuration found for this project');
    });

    it('returns default provider when no routing rules', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        base_url: 'https://api.openai.com', api_key_encrypted: 'enc-key',
        max_tokens: 4096, temperature: 0.1,
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, { labels: [], priority: 'medium' });

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
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        base_url: 'https://api.openai.com', api_key_encrypted: 'enc-key',
        routing_rules: { rules: [] },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, {});

      expect(result.provider).toBe('openai');
    });

    it('matches rule by label (OR logic)', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['frontend'] }, provider: 'frontend-model' },
            { match: { labels: ['backend'] }, provider: 'backend-model' },
          ],
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, { labels: ['backend', 'urgent'] });

      expect(result.provider).toBe('backend-model');
    });

    it('matches rule by priority', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { priority: 'high' }, provider: 'expensive-model' },
            { match: { priority: 'low' }, provider: 'cheap-model' },
          ],
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, { priority: 'high' });

      expect(result.provider).toBe('expensive-model');
    });

    it('matches rule by combined label AND priority', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['frontend'], priority: 'high' }, provider: 'premium' },
            { match: { labels: ['frontend'], priority: 'low' }, provider: 'standard' },
          ],
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, { labels: ['frontend'], priority: 'high' });

      expect(result.provider).toBe('premium');
    });

    it('returns fallback when no rule matches', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['frontend'] }, provider: 'frontend-model' },
          ],
          fallback: { provider: 'fallback-model' },
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, { labels: ['backend'] });

      expect(result.provider).toBe('fallback-model');
      expect(result.is_fallback).toBe(true);
    });

    it('uses rule-level api_key when present', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        api_key_encrypted: 'enc-key',
        routing_rules: {
          rules: [
            { match: { labels: ['test'] }, provider: 'test-model', api_key: 'rule-key' },
          ],
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, { labels: ['test'] });

      expect(result.api_key).toBe('rule-key');
    });

    it('uses rule-level endpoint_url and model overrides', async () => {
      const mockConfig = {
        id: 'pp1', provider_type: 'openai', model: 'gpt-4',
        base_url: 'https://api.openai.com', api_key_encrypted: 'enc-key',
        max_tokens: 4096, temperature: 0.1,
        routing_rules: {
          rules: [
            { match: {}, provider: 'custom', endpoint_url: 'https://custom.api', model: 'custom-model', max_tokens: 8192, temperature: 0.5 },
          ],
        },
      };
      pool.query.mockResolvedValueOnce({ rows: [mockConfig] });

      const result = await ProviderService.resolveProvider(1, {});

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
});
