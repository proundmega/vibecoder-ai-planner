const jwt = require('jsonwebtoken');
const { GitHubAppAuthService } = require('../services/GitHubAppAuthService');
const { decrypt } = require('../utils/crypto');

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'app-jwt'),
}));

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn(() => 'stored-pat'),
}));

const NOW = Date.parse('2026-11-14T00:00:00Z');
const REPO_URL = 'https://github.com/acme/widgets';
const EXPIRES_AT = new Date(NOW + 3600 * 1000).toISOString();

function makeDb({ repos = {}, installations = {} } = {}) {
  return {
    query: jest.fn(async (sql, params) => {
      const projectId = params ? Number(params[0]) : null;
      if (sql.includes('FROM project_github_installations')) {
        const row = installations[projectId];
        return { rows: row ? [{ ...row, project_id: projectId }] : [] };
      }
      if (sql.includes('INSERT INTO project_github_installations')) {
        return {
          rows: [{
            project_id: projectId,
            installation_id: params[1],
            repo_allowlist: params[2],
            disabled_at: null,
            created_at: new Date(NOW),
            updated_at: new Date(NOW),
          }],
        };
      }
      if (sql.includes('UPDATE project_github_installations')) {
        return { rows: [] };
      }
      if (sql.includes('FROM project_repos')) {
        const repo = repos[projectId];
        return { rows: repo ? [repo] : [] };
      }
      return { rows: [] };
    }),
  };
}

function makeService(overrides = {}) {
  const log = { info: jest.fn(), warn: jest.fn() };
  const request = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    data: {
      token: 'ghs_test_token',
      expires_at: EXPIRES_AT,
      permissions: { contents: 'write', metadata: 'read' },
      repositories: [{ full_name: 'acme/widgets' }],
    },
  });
  let now = NOW;
  const service = new GitHubAppAuthService({
    db: overrides.db || makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: { 1: { installation_id: 42, repo_allowlist: [] } },
    }),
    log,
    request,
    now: () => now,
  });
  return {
    service,
    log,
    request,
    setNow: (value) => { now = value; },
    advance: (ms) => { now += ms; },
    now: () => now,
  };
}

const ENV_KEYS = [
  'GITHUB_AUTH_MODE',
  'ALLOW_PAT',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_TOKEN_TTL_SECONDS',
];

let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GITHUB_AUTH_MODE = 'app';
  process.env.GITHUB_APP_ID = '1234';
  process.env.GITHUB_APP_PRIVATE_KEY = 'private-key';
  delete process.env.GITHUB_APP_INSTALLATION_ID;
  delete process.env.ALLOW_PAT;
  delete process.env.GITHUB_TOKEN_TTL_SECONDS;
  decrypt.mockReturnValue('stored-pat');
  jwt.sign.mockReturnValue('app-jwt');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  jest.clearAllMocks();
});

describe('GitHubAppAuthService app mode (fg-35 FR3/FR8/FR10)', () => {
  it('mints a repo-scoped installation token with the minimum permissions', async () => {
    const { service, request, log } = makeService();

    const result = await service.mintToken(1, { operation: 'clone' });

    expect(result).toMatchObject({
      token: 'ghs_test_token',
      mode: 'app',
      repo: 'acme/widgets',
      installationId: 42,
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ iss: '1234' }),
      'private-key',
      { algorithm: 'RS256' }
    );
    expect(request).toHaveBeenCalledWith(
      'POST',
      'https://api.github.com/app/installations/42/access_tokens',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer app-jwt' }),
        body: {
          repositories: ['widgets'],
          permissions: {
            contents: 'write',
            pull_requests: 'write',
            checks: 'read',
            metadata: 'read',
          },
        },
      })
    );
    expect(log.info).toHaveBeenCalledWith(
      'github_app_token_issued',
      expect.objectContaining({
        projectId: 1,
        installationId: 42,
        repo: 'acme/widgets',
        operation: 'clone',
      })
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('ghs_test_token');
  });

  it('reuses the cached token until shortly before expiry', async () => {
    const { service, request, advance } = makeService();

    await service.mintToken(1, { operation: 'clone' });
    advance(30 * 60 * 1000);
    const cached = await service.mintToken(1, { operation: 'push' });

    expect(cached.cached).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);

    advance(26 * 60 * 1000);
    const refreshed = await service.mintToken(1, { operation: 'push' });
    expect(refreshed.cached).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not reuse the same installation/repo cache entry across projects', async () => {
    const db = makeDb({
      repos: {
        1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted-1' },
        2: { repo_url: REPO_URL, access_token_encrypted: 'encrypted-2' },
      },
      installations: {
        1: { installation_id: 42, repo_allowlist: [] },
        2: { installation_id: 42, repo_allowlist: [] },
      },
    });
    const { service, request } = makeService({ db });

    const first = await service.mintToken(1, { operation: 'clone' });
    const second = await service.mintToken(2, { operation: 'clone' });

    expect(first).not.toHaveProperty('cached');
    expect(second).not.toHaveProperty('cached');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached token across projects', async () => {
    const db = makeDb({
      repos: {
        1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted-1' },
        2: { repo_url: 'https://github.com/acme/gadgets', access_token_encrypted: 'encrypted-2' },
      },
      installations: {
        1: { installation_id: 42, repo_allowlist: [] },
        2: { installation_id: 42, repo_allowlist: [] },
      },
    });
    const { service, request } = makeService({ db });
    request
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: {
          token: 'ghs_project_one',
          expires_at: EXPIRES_AT,
          repositories: [{ full_name: 'acme/widgets' }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: {
          token: 'ghs_project_two',
          expires_at: EXPIRES_AT,
          repositories: [{ full_name: 'acme/gadgets' }],
        },
      });

    const first = await service.mintToken(1, { operation: 'clone' });
    const second = await service.mintToken(2, { operation: 'clone' });

    expect(first.repo).toBe('acme/widgets');
    expect(second.repo).toBe('acme/gadgets');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('caps the client-side lifetime at GITHUB_TOKEN_TTL_SECONDS', async () => {
    process.env.GITHUB_TOKEN_TTL_SECONDS = '120';
    const { service } = makeService();

    const result = await service.mintToken(1, { operation: 'clone' });

    expect(Date.parse(result.expiresAt)).toBe(NOW + 120 * 1000);
  });

  it('returns a numeric installation id for pg BIGINT rows', async () => {
    const db = makeDb({
      installations: { 1: { installation_id: '42', repo_allowlist: [] } },
    });
    const { service } = makeService({ db });

    const status = await service.getInstallationStatus(1);

    expect(status.installationId).toBe(42);
  });

  it('rejects a token minted for a different repository', async () => {
    const { service, request } = makeService();
    request.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: {
        token: 'ghs_wrong_repo',
        expires_at: EXPIRES_AT,
        repositories: [{ full_name: 'victim/widgets' }],
      },
    });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_TOKEN_SCOPE_MISMATCH' });
    expect(request).toHaveBeenLastCalledWith(
      'DELETE',
      'https://api.github.com/installation/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghs_wrong_repo' }),
      })
    );
  });

  it('rejects a token response without a repositories list', async () => {
    const { service, request } = makeService();
    request.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: { token: 'ghs_unscoped', expires_at: EXPIRES_AT },
    });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_TOKEN_SCOPE_MISMATCH' });
  });

  it('rejects a bare-name allowlist collision across installations', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: { 1: { installation_id: 42, repo_allowlist: ['widgets'] } },
    });
    const { service, request } = makeService({ db });
    request.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: {
        token: 'ghs_collision',
        expires_at: EXPIRES_AT,
        repositories: [{ full_name: 'victim/widgets' }],
      },
    });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_TOKEN_SCOPE_MISMATCH' });
  });

  it('classifies rate-limit responses separately', async () => {
    const { service, request } = makeService();
    request.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      data: null,
    });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });
  });

  it('bypasses and revokes the cached token on forceRefresh', async () => {
    const { service, request } = makeService();
    await service.mintToken(1, { operation: 'clone' });

    const refreshed = await service.mintToken(1, {
      operation: 'retry',
      forceRefresh: true,
    });

    expect(refreshed.cached).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      'DELETE',
      'https://api.github.com/installation/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghs_test_token' }),
      })
    );
    expect(request.mock.calls.filter((call) => call[0] === 'POST')).toHaveLength(2);
  });

  it('rejects a project whose installation is disabled', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: {
        1: { installation_id: 42, repo_allowlist: [], disabled_at: new Date(NOW) },
      },
    });
    const { service } = makeService({ db });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_ACCESS_DISABLED' });
  });

  it('rejects a repository outside the project allowlist', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: {
        1: { installation_id: 42, repo_allowlist: ['acme/other'] },
      },
    });
    const { service } = makeService({ db });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_REPO_NOT_ALLOWED' });
  });

  it('rejects a requested repository that differs from the connected repo', async () => {
    const { service } = makeService();

    await expect(service.mintToken(1, { operation: 'clone', repo: 'acme/other' }))
      .rejects.toMatchObject({ code: 'GITHUB_REPO_SCOPE_MISMATCH' });
  });

  it('requires an installation mapping unless the single-tenant env fallback is set', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
    });
    const { service, request } = makeService({ db });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_NOT_CONFIGURED' });

    process.env.GITHUB_APP_INSTALLATION_ID = '77';
    await service.mintToken(1, { operation: 'clone' });
    expect(request).toHaveBeenCalledWith(
      'POST',
      'https://api.github.com/app/installations/77/access_tokens',
      expect.any(Object)
    );
  });

  it('fails closed when App credentials are missing', async () => {
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    const { service } = makeService();

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_APP_NOT_CONFIGURED' });
  });

  it('fails closed when GitHub rejects the token request', async () => {
    const { service, request } = makeService();
    request.mockResolvedValueOnce({ ok: false, status: 403, data: null });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_REJECTED' });
  });

  it('maps a network failure to a fail-closed mint error', async () => {
    const { service, request } = makeService();
    request.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_TOKEN_MINT_FAILED' });
  });

  it('fails closed when GitHub returns no token', async () => {
    const { service, request } = makeService();
    request.mockResolvedValueOnce({ ok: true, status: 201, data: {} });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_TOKEN_MINT_FAILED' });
  });
});

describe('GitHubAppAuthService PAT fallback (fg-35 FR9)', () => {
  beforeEach(() => {
    process.env.GITHUB_AUTH_MODE = 'pat';
  });

  it('requires ALLOW_PAT before returning a stored PAT', async () => {
    const { service } = makeService();

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'PAT_FALLBACK_DISABLED' });
  });

  it('returns the stored PAT only when explicitly allowed', async () => {
    process.env.ALLOW_PAT = 'true';
    const { service, log } = makeService();

    const result = await service.mintToken(1, { operation: 'clone' });

    expect(result).toMatchObject({ token: 'stored-pat', mode: 'pat' });
    expect(decrypt).toHaveBeenCalledWith('encrypted');
    expect(log.info).toHaveBeenCalledWith(
      'github_app_token_issued',
      expect.objectContaining({ mode: 'pat', operation: 'clone' })
    );
  });

  it('honours a disabled project in PAT mode', async () => {
    process.env.ALLOW_PAT = 'true';
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: {
        1: { installation_id: 42, repo_allowlist: [], disabled_at: new Date(NOW) },
      },
    });
    const { service } = makeService({ db });

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ code: 'GITHUB_ACCESS_DISABLED' });
  });

  it('rejects an unknown GITHUB_AUTH_MODE', async () => {
    process.env.GITHUB_AUTH_MODE = 'oauth';
    process.env.ALLOW_PAT = 'true';
    const { service } = makeService();

    await expect(service.mintToken(1, { operation: 'clone' }))
      .rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('GitHubAppAuthService installation management (fg-35 FR2/FR7)', () => {
  it('upserts an installation mapping and normalizes the allowlist', async () => {
    const db = makeDb();
    const { service } = makeService({ db });

    const result = await service.setInstallation(1, 42, [
      'https://github.com/acme/widgets',
      'acme/widgets',
      'acme/gadgets',
      'not a repo',
    ]);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO project_github_installations'),
      [1, 42, ['acme/widgets', 'acme/gadgets']]
    );
    expect(result.repoAllowlist).toEqual(['acme/widgets', 'acme/gadgets']);
    expect(result.disabled).toBe(false);
    expect(result.installationId).toBe(42);
  });

  it('revokes cached tokens when the installation mapping changes', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: { 1: { installation_id: 42, repo_allowlist: [] } },
    });
    const { service, request } = makeService({ db });
    await service.mintToken(1, { operation: 'clone' });

    const result = await service.setInstallation(1, 43, []);

    expect(result.revoked).toBe(1);
    expect(request).toHaveBeenCalledWith(
      'DELETE',
      'https://api.github.com/installation/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghs_test_token' }),
      })
    );
  });

  it('does not revoke tokens when the mapping is unchanged', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: { 1: { installation_id: 42, repo_allowlist: [] } },
    });
    const { service, request } = makeService({ db });
    await service.mintToken(1, { operation: 'clone' });

    const result = await service.setInstallation(1, 42, []);

    expect(result.revoked).toBe(0);
    expect(request.mock.calls.filter((call) => call[0] === 'DELETE')).toHaveLength(0);

    // The cached token must remain revocable after a no-op PUT.
    const disabled = await service.disableProject(1);
    expect(disabled).toEqual({ disabled: true, revoked: 1, cachedTokens: 1 });
    expect(request).toHaveBeenCalledWith(
      'DELETE',
      'https://api.github.com/installation/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghs_test_token' }),
      })
    );
  });

  it('normalizes bare repo names and case in the allowlist', async () => {
    const db = makeDb();
    const { service } = makeService({ db });

    const result = await service.setInstallation(1, 42, [
      'widgets',
      'Acme/Widgets',
    ]);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO project_github_installations'),
      [1, 42, ['widgets', 'acme/widgets']]
    );
    expect(result.repoAllowlist).toEqual(['widgets', 'acme/widgets']);
  });

  it('disables access and revokes the cached installation token', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: { 1: { installation_id: 42, repo_allowlist: [] } },
    });
    const { service, request, log } = makeService({ db });
    await service.mintToken(1, { operation: 'clone' });

    const result = await service.disableProject(1);

    expect(result).toEqual({ disabled: true, revoked: 1, cachedTokens: 1 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SET disabled_at = NOW()'),
      [1]
    );
    expect(request).toHaveBeenLastCalledWith(
      'DELETE',
      'https://api.github.com/installation/token',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghs_test_token',
        }),
      })
    );
    expect(log.info).toHaveBeenCalledWith(
      'github_app_access_disabled',
      expect.objectContaining({
        projectId: 1,
        installationId: 42,
        revoked: 1,
        cachedTokens: 1,
      })
    );
  });

  it('keeps the project disabled even when revocation fails', async () => {
    const db = makeDb({
      repos: { 1: { repo_url: REPO_URL, access_token_encrypted: 'encrypted' } },
      installations: { 1: { installation_id: 42, repo_allowlist: [] } },
    });
    const { service, request, log } = makeService({ db });
    await service.mintToken(1, { operation: 'clone' });
    request.mockRejectedValueOnce(new Error('network down'));

    const result = await service.disableProject(1);

    expect(result).toEqual({ disabled: true, revoked: 0, cachedTokens: 1 });
    expect(log.warn).toHaveBeenCalledWith(
      'github_app_installation_revoke_failed',
      expect.objectContaining({ projectId: 1 })
    );
  });

  it('reports when no cached token can be revoked', async () => {
    const db = makeDb({
      installations: { 1: { installation_id: 42, repo_allowlist: [] } },
    });
    const { service, log } = makeService({ db });

    const result = await service.disableProject(1);

    expect(result).toEqual({ disabled: true, revoked: 0, cachedTokens: 0 });
    expect(log.warn).toHaveBeenCalledWith(
      'github_app_disable_no_cached_token',
      expect.objectContaining({ projectId: 1 })
    );
  });

  it('rejects disabling a project with no installation mapping', async () => {
    const { service } = makeService({ db: makeDb() });

    await expect(service.disableProject(1))
      .rejects.toThrow('No GitHub App installation is configured for this project');
  });
});
