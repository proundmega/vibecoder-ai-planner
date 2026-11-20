jest.mock('../utils/crypto', () => ({
  encrypt: (value) => `enc:${value}`,
  decrypt: (value) => String(value).replace(/^enc:/, ''),
}));
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
