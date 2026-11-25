jest.mock('../providers/github', () => {
  const GitHubProvider = jest.fn();
  GitHubProvider.parseRepoUrl = jest.fn(url => ({ owner: 'owner', repo: 'repo', url }));
  GitHubProvider.validateRepoAccess = jest.fn().mockResolvedValue({
    accessible: true,
    defaultBranch: 'main',
    private: false,
    error: null,
  });
  GitHubProvider.validatePAT = jest.fn().mockResolvedValue({ valid: true });
  return { GitHubProvider };
});

const {
  PROVIDER_IDS,
  getCapabilities,
  normalizeProviderId,
  assertSafeBaseUrl,
  isPrivateHostname,
  createRegistry,
} = require('../providers/git/GitProvider');
const git = require('../providers/git');
const { GitHubProvider } = require('../providers/github');

describe('Git provider contract', () => {
  it('lists providers and their capabilities', () => {
    expect(PROVIDER_IDS).toEqual(['github', 'forgejo', 'gitea', 'gitlab', 'local']);
    expect(getCapabilities('github')).toMatchObject({
      supportsReviewRequests: true,
      supportsInstallations: true,
      reviewRequestName: 'pull request',
    });
    expect(getCapabilities('gitlab')).toMatchObject({
      supportsReviewRequests: true,
      supportsInstallations: false,
      reviewRequestName: 'merge request',
      requiresBaseUrl: true,
    });
    expect(getCapabilities('local')).toMatchObject({
      supportsReviewRequests: false,
      supportsInstallations: false,
      reviewRequestName: 'branch',
      requiresBaseUrl: false,
    });
  });

  it('normalises ids and rejects unknown providers', () => {
    expect(normalizeProviderId(' GitHub ')).toBe('github');
    expect(() => getCapabilities('bitbucket')).toThrow('Unsupported Git provider');
    expect(() => normalizeProviderId('')).toThrow('Git provider is required');
  });

  describe('assertSafeBaseUrl', () => {
    const saved = process.env.ALLOW_PRIVATE_HOSTS;
    const publicLookup = jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const safeBaseUrl = (url, options = {}) => assertSafeBaseUrl(url, { lookup: publicLookup, ...options });

    beforeEach(() => {
      delete process.env.ALLOW_PRIVATE_HOSTS;
      publicLookup.mockClear();
    });

    afterEach(() => {
      if (saved === undefined) delete process.env.ALLOW_PRIVATE_HOSTS;
      else process.env.ALLOW_PRIVATE_HOSTS = saved;
    });

    it('normalises absolute URLs', async () => {
      await expect(safeBaseUrl(' https://git.example.com/gitea/ '))
        .resolves.toBe('https://git.example.com/gitea');
      await expect(safeBaseUrl('http://git.example.com')).resolves.toBe('http://git.example.com');
      await expect(safeBaseUrl('https://fcgit.example.com')).resolves.toBe('https://fcgit.example.com');
    });

    it.each([
      ['git.example.com', 'absolute URL'],
      ['ftp://git.example.com', 'http or https'],
      ['https://user:pass@git.example.com', 'must not embed credentials'],
      ['https://git.example.com?x=1', 'must not include a query or fragment'],
    ])('rejects %s', async (url, message) => {
      await expect(safeBaseUrl(url)).rejects.toThrow(message);
    });

    it.each([
      'http://127.0.0.1',
      'http://10.1.2.3',
      'http://172.20.0.5',
      'http://192.168.1.2',
      'http://[::1]',
      'http://localhost.',
      'http://foo.localhost.',
      'http://metadata.google.internal.',
      'http://[::ffff:127.0.0.1]',
      'http://[::ffff:169.254.169.254]',
      'http://[::ffff:a00:1]',
      'http://[::127.0.0.1]',
      'http://[::10.0.0.1]',
    ])('rejects private literal %s', async (url) => {
      await expect(safeBaseUrl(url)).rejects.toThrow('not allowed by the host policy');
    });

    it.each([
      ['http://127.0.0.1.nip.io', '127.0.0.1'],
      ['http://localtest.me', '127.0.0.1'],
      ['http://metadata.example.com', '169.254.169.254'],
      ['http://private.example.com', '10.0.0.1'],
      ['http://mapped.example.com', '0:0:0:0:0:ffff:7f00:1'],
      ['http://mapped-metadata.example.com', '0:0:0:0:0:ffff:a9fe:a9fe'],
      ['http://mapped-v4tail.example.com', '0:0:0:0:0:ffff:127.0.0.1'],
    ])('rejects %s when it resolves to %s', async (url, address) => {
      const lookup = jest.fn().mockResolvedValue([
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      await expect(assertSafeBaseUrl(url, { lookup }))
        .rejects.toThrow('not allowed by the host policy');
      expect(lookup).toHaveBeenCalled();
    });

    it('allows a public IPv6 address and detects expanded mapped literals', async () => {
      const lookup = jest.fn().mockResolvedValue([{ address: '2001:db8::1', family: 6 }]);

      await expect(assertSafeBaseUrl('https://ipv6.example.com', { lookup }))
        .resolves.toBe('https://ipv6.example.com');
      expect(isPrivateHostname('0:0:0:0:0:ffff:7f00:1')).toBe(true);
      expect(isPrivateHostname('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true);
      expect(isPrivateHostname('::7f00:1')).toBe(true);
      expect(isPrivateHostname('::a00:1')).toBe(true);
      expect(isPrivateHostname('2001:db8::1')).toBe(false);
    });

    it('fails closed when the host cannot be resolved', async () => {
      const lookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
      await expect(assertSafeBaseUrl('https://git.example.com', { lookup }))
        .rejects.toThrow('could not be resolved');

      lookup.mockResolvedValueOnce([]);
      await expect(assertSafeBaseUrl('https://empty.example.com', { lookup }))
        .rejects.toThrow('could not be resolved');
    });

    it('allows private hosts when the host policy enables them', async () => {
      process.env.ALLOW_PRIVATE_HOSTS = '1';
      const lookup = jest.fn();

      await expect(assertSafeBaseUrl('http://127.0.0.1:3000', { lookup }))
        .resolves.toBe('http://127.0.0.1:3000');
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe('registry', () => {
    it('registers and resolves providers by id', () => {
      const registry = createRegistry();
      const provider = { id: 'local' };
      const factory = jest.fn(() => provider);

      registry.register('local', factory);

      expect(registry.has('LOCAL')).toBe(true);
      expect(registry.get(' local ', 'credential')).toBe(provider);
      expect(factory).toHaveBeenCalledWith('credential');
      expect(registry.list().find(entry => entry.id === 'local'))
        .toMatchObject({ registered: true, supportsReviewRequests: false });
    });

    it('rejects unknown or unregistered providers', () => {
      const registry = createRegistry();

      expect(() => registry.register('bitbucket', () => ({}))).toThrow('Unsupported Git provider');
      expect(() => registry.register('local', null)).toThrow('factory must be a function');
      expect(() => registry.get('github')).toThrow('not registered');
      expect(registry.has('github')).toBe(false);
      expect(registry.has(undefined)).toBe(false);
    });
  });
});

describe('Local provider', () => {
  it('registers and parses SSH and filesystem URLs', () => {
    expect(git.registry.has('local')).toBe(true);
    const provider = git.registry.get('local', {
      credential: 'key',
      authMode: 'ssh',
    });

    expect(provider.id).toBe('local');
    expect(provider.capabilities.supportsReviewRequests).toBe(false);
    expect(provider.parseRepoUrl('ssh://git@git.example.com/group/repo.git'))
      .toMatchObject({ host: 'git.example.com', protocol: 'ssh' });
    expect(provider.parseRepoUrl('git@git.example.com:group/repo.git'))
      .toMatchObject({ host: 'git.example.com', protocol: 'ssh' });
    expect(provider.parseRepoUrl('/srv/git/private-app.git'))
      .toMatchObject({ protocol: 'file', path: '/srv/git/private-app.git' });
    expect(provider.getCloneUrl('/srv/git/private-app.git'))
      .toBe('/srv/git/private-app.git');
  });

  it('requires an SSH key and has no review API', async () => {
    const provider = git.local.createProvider({ authMode: 'ssh' });

    await expect(provider.validateRepoAccess('ssh://git@git.example.com/group/repo.git'))
      .resolves.toMatchObject({ accessible: false });
    await expect(provider.validateRepoAccess(
      'ssh://git@git.example.com/group/repo.git', 'private-key'))
      .resolves.toMatchObject({ accessible: true });
    expect(() => provider.parseRepoUrl('https://git.example.com/group/repo'))
      .toThrow('must use an SSH or filesystem');
    await expect(provider.createReviewRequest()).resolves.toBeNull();
    expect(await provider.listReviewRequests()).toEqual([]);
  });
});

describe('GitHub provider adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers GitHub with its capabilities', () => {
    expect(git.registry.has('github')).toBe(true);

    const provider = git.registry.get('github', 'token-1');

    expect(GitHubProvider).toHaveBeenCalledWith('token-1');
    expect(provider.id).toBe('github');
    expect(provider.capabilities).toMatchObject({
      supportsReviewRequests: true,
      supportsInstallations: true,
    });
  });

  it('delegates parsing, validation and helper calls to GitHub', async () => {
    const provider = git.registry.get('github', 'token-1');

    expect(provider.parseRepoUrl('owner/repo'))
      .toEqual({ owner: 'owner', repo: 'repo', url: 'owner/repo' });
    await expect(provider.validateRepoAccess('owner/repo'))
      .resolves.toMatchObject({ accessible: true, defaultBranch: 'main' });
    await expect(provider.getDefaultBranch('owner/repo')).resolves.toBe('main');
    expect(provider.getCloneUrl('owner/repo')).toBe('https://github.com/owner/repo.git');
    expect(GitHubProvider.validateRepoAccess).toHaveBeenCalledWith('token-1', 'owner', 'repo');
  });

  it('rejects getDefaultBranch when access validation fails', async () => {
    GitHubProvider.validateRepoAccess.mockResolvedValueOnce({ accessible: false, error: 'nope' });
    const provider = git.registry.get('github', 'token-1');

    await expect(provider.getDefaultBranch('owner/repo')).rejects.toThrow('Repository is not accessible');
  });

  it('forwards branch, review and file operations to GitHub', async () => {
    const inner = {
      getFileContent: jest.fn().mockResolvedValue('contents'),
      createBranch: jest.fn().mockResolvedValue('branch'),
      deleteBranch: jest.fn().mockResolvedValue(undefined),
      listBranches: jest.fn().mockResolvedValue(['branch']),
      createPR: jest.fn().mockResolvedValue({ url: 'pr' }),
      listPRs: jest.fn().mockResolvedValue([{ url: 'pr' }]),
      getPRDiff: jest.fn().mockResolvedValue({ files: [] }),
    };
    GitHubProvider.mockImplementationOnce(() => inner);
    const provider = git.registry.get('github', 'token-1');
    const repo = { repoUrl: 'owner/repo' };

    await expect(provider.getFileContent(repo, 'a.md', 'main')).resolves.toBe('contents');
    expect(inner.getFileContent).toHaveBeenCalledWith(repo, 'a.md', 'main');
    await expect(provider.createBranch(repo, 1, 'Title')).resolves.toBe('branch');
    expect(inner.createBranch).toHaveBeenCalledWith(repo, 1, 'Title');
    await expect(provider.deleteBranch(repo, 'branch')).resolves.toBeUndefined();
    expect(inner.deleteBranch).toHaveBeenCalledWith(repo, 'branch');
    await expect(provider.listBranches(repo)).resolves.toEqual(['branch']);
    expect(inner.listBranches).toHaveBeenCalledWith(repo);
    await expect(provider.createReviewRequest(repo, 1, 'Title', 'branch', 'desc')).resolves.toEqual({ url: 'pr' });
    expect(inner.createPR).toHaveBeenCalledWith(repo, 1, 'Title', 'branch', 'desc');
    await expect(provider.listReviewRequests(repo)).resolves.toEqual([{ url: 'pr' }]);
    expect(inner.listPRs).toHaveBeenCalledWith(repo);
    await expect(provider.getReviewDiff(repo, 7)).resolves.toEqual({ files: [] });
    expect(inner.getPRDiff).toHaveBeenCalledWith(repo, 7);
  });
});
