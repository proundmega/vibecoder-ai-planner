const ProviderService = require('../services/ProviderService');
const { decrypt } = require('../utils/crypto');

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn(),
}));

const { pool } = require('../db');

function registryRow(overrides = {}) {
  return {
    credential_id: 1,
    provider_type: 'openai',
    api_key_encrypted: 'enc-key',
    base_url: 'https://api.openai.com',
    project_id: 1,
    model_id: 10,
    model: 'gpt-4',
    max_tokens: 4096,
    roles: ['worker'],
    effort: 'medium',
    ...overrides,
  };
}

describe('ProviderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PROVIDER_DEFAULT_TEMPERATURE;
    decrypt.mockReturnValue('decrypted-mock-key');
    ProviderService.invalidateProviderCache();
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('getProjectProviders', () => {
    it('reads project and owner-global credentials from the registry', async () => {
      const rows = [
        registryRow(),
        registryRow({ credential_id: 2, project_id: null, model_id: 11 }),
      ];
      pool.query.mockResolvedValueOnce({ rows });

      const result = await ProviderService.getProjectProviders(1, 7);

      expect(result).toEqual(rows);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FROM provider_credentials pc');
      expect(sql).toContain("pm.status = 'verified'");
      expect(sql).toContain('pc.owner_id = $2');
      expect(params).toEqual([1, 7, 'worker']);
    });

    it('uses owner-global credentials when no project is supplied', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow({ project_id: null })] });

      await ProviderService.getProjectProviders(null, 7);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('pc.project_id IS NULL');
      expect(sql).not.toContain('JOIN projects');
      expect(params).toEqual([7, 'worker']);
    });

    it('returns no providers without a project or owner', async () => {
      const result = await ProviderService.getProjectProviders(null, null);

      expect(result).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns an empty array when the registry has no rows', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(ProviderService.getProjectProviders(1, 7)).resolves.toEqual([]);
    });

    it('caches per project and owner', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow()] });

      const first = await ProviderService.getProjectProviders(1, 7);
      const second = await ProviderService.getProjectProviders(1, 7);

      expect(first).toBe(second);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveProvider', () => {
    it('throws when no active registry provider exists', async () => {
      await expect(
        ProviderService.resolveProvider({}, 1, 7)
      ).rejects.toThrow('No active provider configuration found');
    });

    it('returns the first registry model as a provider config', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow()] });

      const result = await ProviderService.resolveProvider({}, 1, 7);

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

    it('falls back to 4096 max tokens and the provider default endpoint', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [registryRow({ provider_type: 'opencode', base_url: null, max_tokens: null })],
      });

      const result = await ProviderService.resolveProvider({}, 1, 7);

      expect(result.max_tokens).toBe(4096);
      expect(result.endpoint_url).toBe('https://opencode.ai/inference/openai/v1');
    });


    it('selects planner models from the planning phase', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [registryRow({ roles: ['planner'], model: 'plan-model' })],
      });

      const result = await ProviderService.resolveProvider({ phase: 'planning' }, 1, 7);

      expect(result.model).toBe('plan-model');
      expect(pool.query.mock.calls[0][1]).toEqual([1, 7, 'planner']);
    });

    it('selects reviewer models from the review phase', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow({ roles: ['reviewer'] })] });

      await ProviderService.resolveProvider({ phase: 'review' }, 1, 7);

      expect(pool.query.mock.calls[0][1]).toEqual([1, 7, 'reviewer']);
    });

    it('prefers an explicit role over the phase', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow()] });

      await ProviderService.resolveProvider({ role: 'worker', phase: 'planning' }, 1, 7);

      expect(pool.query.mock.calls[0][1]).toEqual([1, 7, 'worker']);
    });

    it('filters the registry query by the selected role', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow()] });

      await ProviderService.resolveProvider({}, 1, 7);

      expect(pool.query.mock.calls[0][0]).toContain('$3 = ANY(pm.roles)');
    });

    it('passes the project and owner to the registry query', async () => {
      pool.query.mockResolvedValueOnce({ rows: [registryRow()] });

      await ProviderService.resolveProvider({ role: 'worker' }, 1, 7);

      expect(pool.query.mock.calls[0][1]).toEqual([1, 7, 'worker']);
    });
  });
});
