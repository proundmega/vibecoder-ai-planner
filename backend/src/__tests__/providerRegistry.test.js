jest.mock('../utils/crypto', () => ({
  encrypt: (value) => `enc:${value}`,
  decrypt: (value) => String(value).replace(/^enc:/, ''),
}));
const dns = require('dns');
const { pool } = require('../db');
const ProviderRegistryService = require('../services/ProviderRegistryService');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
}));

const user = { userId: 7, role: 'project_admin' };

describe('ProviderRegistryService (FR5-FR9, FR18, FR19)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    global.fetch = jest.fn();
  });

  it('encrypts the secret on create and never returns it', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 1, owner_id: 7, project_id: 3, name: 'c', api_key_encrypted: 'enc:sk' }],
    });
    const result = await ProviderRegistryService.create(user, {
      projectId: 3,
      name: 'c',
      providerType: 'claude',
      apiKey: 'sk',
    });
    expect(result.api_key_encrypted).toBeUndefined();
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO provider_credentials'));
    expect(insert[1][4]).toBe('enc:sk');
  });

  it('lists credentials without secrets', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 1, owner_id: 7, api_key_encrypted: 'enc:sk' }],
    });
    const rows = await ProviderRegistryService.list(user);
    expect(rows[0].api_key_encrypted).toBeUndefined();
  });

  it('accepts a project owner even without the global project_admin role', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, owner_id: 7, project_id: 3, api_key_encrypted: 'enc:sk' }],
    });
    const owner = { userId: 7, role: 'member' };
    const result = await ProviderRegistryService.create(owner, {
      projectId: 3, name: 'c', providerType: 'openai', apiKey: 'sk',
    });
    expect(result.id).toBe(1);
  });

  it('rejects a private base URL (SSRF guard)', async () => {
    await expect(
      ProviderRegistryService.create(user, {
        name: 'c', providerType: 'openai', apiKey: 'sk', baseUrl: 'http://127.0.0.1:9000',
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_BASE_URL' });
  });

  it('rejects an unsupported provider type', async () => {
    await expect(
      ProviderRegistryService.create(user, {
        name: 'c', providerType: 'super-agent', apiKey: 'sk',
      })
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_TYPE' });
  });

  it('lists all models for a credential', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: 7, project_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, model: 'm' }, { id: 10, model: 'n' }] });
    const rows = await ProviderRegistryService.listModels(user, 1);
    expect(rows).toHaveLength(2);
  });

  it('returns the in-use references in a 409', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: 7, project_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, model: 'm' }] });
    await expect(ProviderRegistryService.remove(user, 1)).rejects.toMatchObject({
      code: 'CREDENTIAL_IN_USE',
      details: { models: [{ id: 9, model: 'm' }] },
    });
  });

  it('refuses to delete a credential that still has models', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: 7, project_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, model: 'm' }] });
    await expect(ProviderRegistryService.remove(user, 1)).rejects.toMatchObject({
      code: 'CREDENTIAL_IN_USE',
    });
  });

  it('rejects an invalid role when adding a model', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, owner_id: 7, project_id: null }] });
    await expect(
      ProviderRegistryService.addModel(user, 1, { model: 'm', roles: ['super-agent'] })
    ).rejects.toMatchObject({ code: 'INVALID_ROLE' });
  });

  it('marks a model verified when the provider test succeeds', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 9, model: 'm', credential_id: 1, owner_id: 7, project_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          owner_id: 7,
          provider_type: 'openai',
          api_key_encrypted: 'enc:sk',
          base_url: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'verified' }] });
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    const result = await ProviderRegistryService.testModel(user, 9);
    expect(result.verified).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/chat/completions'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('uses the OpenCode Go endpoint and session header for verification', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 9, model: 'beam-free', credential_id: 1, owner_id: 7, project_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          owner_id: 7,
          provider_type: 'opencode-go',
          api_key_encrypted: 'enc:sk',
          base_url: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'verified' }] });
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await ProviderRegistryService.testModel(user, 9);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
    expect(options.headers['x-opencode-session']).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it('does not double /v1 when the credential stores the runtime base', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 9, model: 'beam-free', credential_id: 1, owner_id: 7, project_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          owner_id: 7,
          provider_type: 'opencode-go',
          api_key_encrypted: 'enc:sk',
          base_url: 'https://opencode.ai/inference/go/openai/v1',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'verified' }] });
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await ProviderRegistryService.testModel(user, 9);

    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
  });

  it('keeps query parameters before the appended v1 path', async () => {
    jest.spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 9, model: 'beam-free', credential_id: 1, owner_id: 7, project_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          owner_id: 7,
          provider_type: 'opencode-go',
          api_key_encrypted: 'enc:sk',
          base_url: 'https://opencode.ai/inference/go/openai///?api-version=2026-01-01',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'verified' }] });
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await ProviderRegistryService.testModel(user, 9);

    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe(
      'https://opencode.ai/inference/go/openai/v1/chat/completions?api-version=2026-01-01'
    );
  });

  it('uses the OpenCode endpoint and session header for verification', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 9, model: 'beam-free', credential_id: 1, owner_id: 7, project_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          owner_id: 7,
          provider_type: 'opencode',
          api_key_encrypted: 'enc:sk',
          base_url: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'verified' }] });
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await ProviderRegistryService.testModel(user, 9);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://opencode.ai/inference/openai/v1/chat/completions');
    expect(options.headers['x-opencode-session']).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it('sends the OpenCode session header during model discovery', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1, owner_id: 7, provider_type: 'opencode-go',
          api_key_encrypted: 'enc:sk', base_url: null,
        }],
      })
      .mockResolvedValue({ rows: [] });
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'beam-free' }] }),
    });

    await ProviderRegistryService.discover(user, 1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://opencode.ai/inference/go/openai/v1/models');
    expect(options.headers['x-opencode-session']).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it('maps discovery transport failures to 502', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, owner_id: 7, provider_type: 'openai',
        api_key_encrypted: 'enc:sk', base_url: null,
      }],
    });
    global.fetch.mockRejectedValue(new Error('boom'));
    await expect(ProviderRegistryService.discover(user, 1)).rejects.toMatchObject({
      code: 'DISCOVERY_FAILED',
      status: 502,
    });
  });

  it('stores discovered models as unverified', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          owner_id: 7,
          provider_type: 'openai',
          api_key_encrypted: 'enc:sk',
          base_url: 'https://api.example.com',
        }],
      })
      .mockResolvedValue({ rows: [{ id: 3, model: 'gpt-x', status: 'unverified' }] });
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'gpt-x' }] }),
    });

    const rows = await ProviderRegistryService.discover(user, 1);
    expect(rows[0].status).toBe('unverified');
  });
});
