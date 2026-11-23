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
    });
    expect(getCapabilities('local')).toMatchObject({
      supportsReviewRequests: false,
      supportsInstallations: false,
      reviewRequestName: 'branch',
    });
  });

  it('normalises ids and rejects unknown providers', () => {
    expect(normalizeProviderId(' GitHub ')).toBe('github');
    expect(() => getCapabilities('bitbucket')).toThrow('Unsupported Git provider');
    expect(() => normalizeProviderId('')).toThrow('Git provider is required');
  });

  describe('assertSafeBaseUrl', () => {
    const saved = process.env.ALLOW_PRIVATE_HOSTS;

    afterEach(() => {
      if (saved === undefined) delete process.env.ALLOW_PRIVATE_HOSTS;
      else process.env.ALLOW_PRIVATE_HOSTS = saved;
    });

    it('normalises absolute URLs', () => {
      expect(assertSafeBaseUrl(' https://git.example.com/gitea/ '))
        .toBe('https://git.example.com/gitea');
      expect(assertSafeBaseUrl('http://git.example.com')).toBe('http://git.example.com');
      expect(assertSafeBaseUrl('https://fcgit.example.com')).toBe('https://fcgit.example.com');
    });

    it.each([
      ['git.example.com', 'absolute URL'],
      ['ftp://git.example.com', 'http or https'],
      ['https://user:pass@git.example.com', 'must not embed credentials'],
      ['https://git.example.com?x=1', 'must not include a query or fragment'],
    ])('rejects %s', (url, message) => {
      expect(() => assertSafeBaseUrl(url)).toThrow(message);
    });

    it('rejects private hosts unless the host policy allows them', () => {
      delete process.env.ALLOW_PRIVATE_HOSTS;
      for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.2', '[::1]']) {
        expect(() => assertSafeBaseUrl(`http://${host}`)).toThrow('not allowed by the host policy');
      }
      process.env.ALLOW_PRIVATE_HOSTS = '1';
      expect(assertSafeBaseUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
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
});
