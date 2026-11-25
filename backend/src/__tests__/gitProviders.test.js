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
    expect(getCapabilities('local').authModes).toEqual(['ssh']);
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
  it('registers and parses SSH URLs', () => {
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
    expect(provider.getCloneUrl('git@git.example.com:group/repo.git'))
      .toBe('git@git.example.com:group/repo.git');
  });

  it('rejects embedded passwords, filesystem paths and empty paths', () => {
    const provider = git.local.createProvider({ authMode: 'ssh' });

    expect(() => provider.parseRepoUrl(
      'ssh://git:secret@git.example.com/group/repo.git'))
      .toThrow('must not contain a password');
    expect(() => provider.parseRepoUrl(
      'user:secret@git.example.com:group/repo.git'))
      .toThrow('must not contain a password');
    expect(() => provider.parseRepoUrl(
      'ssh://user%3Apass@git.example.com/group/repo.git'))
      .toThrow('must not contain a password');
    expect(() => provider.parseRepoUrl(
      'user%3Apass@git.example.com:group/repo.git'))
      .toThrow('must not contain a password');
    expect(() => provider.parseRepoUrl('/srv/git/private-app.git'))
      .toThrow('deferred to fg-57d2');
    expect(() => provider.parseRepoUrl('file:///srv/git/private-app.git'))
      .toThrow('deferred to fg-57d2');
    expect(() => provider.parseRepoUrl('ssh://git@git.example.com/'))
      .toThrow('must include a repository path');
  });

  it('applies the private-host policy to SSH hosts', async () => {
    const saved = process.env.ALLOW_PRIVATE_HOSTS;
    const savedGit = process.env.GIT_ALLOW_PRIVATE_HOSTS;
    const publicLookup = jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const provider = git.local.createProvider({ authMode: 'ssh', lookup: publicLookup });
    try {
      delete process.env.ALLOW_PRIVATE_HOSTS;
      delete process.env.GIT_ALLOW_PRIVATE_HOSTS;
      for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '[::1]']) {
        await expect(provider.validateRepoAccess(
          `ssh://git@${host}/group/repo.git`, 'key'))
          .resolves.toMatchObject({ accessible: false });
      }
      await expect(provider.validateRepoAccess(
        'ssh://git@git.example.com/group/repo.git', 'key'))
        .resolves.toMatchObject({ accessible: true });

      process.env.ALLOW_PRIVATE_HOSTS = '1';
      await expect(provider.validateRepoAccess(
        'ssh://git@127.0.0.1/group/repo.git', 'key'))
        .resolves.toMatchObject({ accessible: true });

      delete process.env.ALLOW_PRIVATE_HOSTS;
      process.env.GIT_ALLOW_PRIVATE_HOSTS = '1';
      await expect(provider.validateRepoAccess(
        'ssh://git@127.0.0.1/group/repo.git', 'key'))
        .resolves.toMatchObject({ accessible: true });
    } finally {
      if (saved === undefined) delete process.env.ALLOW_PRIVATE_HOSTS;
      else process.env.ALLOW_PRIVATE_HOSTS = saved;
      if (savedGit === undefined) delete process.env.GIT_ALLOW_PRIVATE_HOSTS;
      else process.env.GIT_ALLOW_PRIVATE_HOSTS = savedGit;
    }
  });

  it('rejects a public name that resolves to a private address', async () => {
    const privateLookup = jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const provider = git.local.createProvider({ authMode: 'ssh', lookup: privateLookup });

    await expect(provider.validateRepoAccess(
      'ssh://git@127.0.0.1.sslip.io/group/repo.git', 'key'))
      .resolves.toMatchObject({
        accessible: false,
        error: 'SSH host is not allowed by the host policy',
      });
    expect(privateLookup).toHaveBeenCalledWith(
      '127.0.0.1.sslip.io', { all: true, verbatim: true });
  });

  it('fails closed when the SSH host cannot be resolved', async () => {
    const failingLookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const provider = git.local.createProvider({ authMode: 'ssh', lookup: failingLookup });

    await expect(provider.validateRepoAccess(
      'ssh://git@unresolvable.example.com/group/repo.git', 'key'))
      .resolves.toMatchObject({
        accessible: false,
        error: 'SSH host could not be resolved',
      });
  });

  it('requires an SSH key and has no review API', async () => {
    const publicLookup = jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const provider = git.local.createProvider({ authMode: 'ssh', lookup: publicLookup });

    await expect(provider.validateRepoAccess('ssh://git@git.example.com/group/repo.git'))
      .resolves.toMatchObject({ accessible: false });
    await expect(provider.validateRepoAccess(
      'ssh://git@git.example.com/group/repo.git', 'private-key'))
      .resolves.toMatchObject({ accessible: true });
    expect(() => provider.parseRepoUrl('https://git.example.com/group/repo'))
      .toThrow('must use an SSH URL');
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

describe('Forgejo/Gitea provider', () => {
  const baseUrl = 'https://git.example.com';
  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
  const provider = () => git.forgejo.createProvider({ baseUrl, credential: 'token' }, 'forgejo');

  it('registers and parses HTTPS, SSH and shorthand URLs', () => {
    expect(git.registry.has('forgejo')).toBe(true);
    expect(git.registry.has('gitea')).toBe(true);
    expect(provider().parseRepoUrl('https://git.example.com/acme/widgets.git'))
      .toMatchObject({ owner: 'acme', repo: 'widgets', protocol: 'https' });
    expect(provider().parseRepoUrl('https://git.example.com:443/acme/widgets'))
      .toMatchObject({ owner: 'acme', repo: 'widgets', protocol: 'https' });
    expect(provider().parseRepoUrl('HTTPS://GIT.EXAMPLE.COM/acme/widgets.git'))
      .toMatchObject({
        protocol: 'https',
        cloneUrl: 'https://git.example.com/acme/widgets.git',
      });
    expect(provider().parseRepoUrl('ssh://git@git.example.com/acme/widgets.git'))
      .toMatchObject({ protocol: 'ssh', cloneUrl: 'ssh://git@git.example.com/acme/widgets.git' });
    expect(provider().parseRepoUrl('git@git.example.com:acme/widgets.git'))
      .toMatchObject({ host: 'git.example.com', protocol: 'ssh', owner: 'acme' });
    expect(provider().parseRepoUrl('acme/widgets'))
      .toMatchObject({
        owner: 'acme',
        repo: 'widgets',
        cloneUrl: 'https://git.example.com/acme/widgets.git',
      });
  });

  it('rejects mismatched origins, credentials and path traversal', () => {
    const reject = (repoUrl, message) => expect(() => provider().parseRepoUrl(repoUrl))
      .toThrow(message);
    reject('https://other.example.com/acme/widgets', 'host must match');
    reject('https://git.example.com:8443/acme/widgets', 'scheme and port');
    reject('http://git.example.com/acme/widgets', 'scheme and port');
    reject('ssh://git@evil.example.com/acme/widgets.git', 'host must match');
    reject('git@evil.example.com:acme/widgets.git', 'host must match');
    reject('https://user:pass@git.example.com/acme/widgets', 'must not contain credentials');
    reject('https://token@git.example.com/acme/widgets', 'must not contain credentials');
    reject('ssh://token@git.example.com/acme/widgets', 'git user');
    reject('git:pass@git.example.com:acme/widgets.git', 'git user');
    reject('git@git.example.com:../admin.git', 'plain path segments');
    reject('../admin', 'plain path segments');
    reject('acme/..', 'plain path segments');
    reject('acme/../admin', 'owner/repo');
    reject('https://git.example.com/acme/widgets?ref=main', 'query or fragment');
    reject('https://git.example.com/acme/widgets#readme', 'query or fragment');
  });

  it('round-trips a shorthand clone URL on a sub-path base', () => {
    const subPath = git.forgejo.createProvider(
      { baseUrl: 'https://git.example.com/forgejo', credential: 'token' }, 'forgejo');
    const parsed = subPath.parseRepoUrl('acme/widgets');
    expect(parsed.cloneUrl).toBe('https://git.example.com/forgejo/acme/widgets.git');
    expect(subPath.parseRepoUrl(parsed.cloneUrl)).toMatchObject({
      owner: 'acme',
      repo: 'widgets',
      cloneUrl: parsed.cloneUrl,
    });
    expect(() => subPath.parseRepoUrl('https://git.example.com/other/acme/widgets'))
      .toThrow('base URL path');
  });

  it('accepts a repository on the configured base port only', () => {
    const portBase = git.forgejo.createProvider(
      { baseUrl: 'https://git.example.com:8443', credential: 'token' }, 'gitea');
    expect(portBase.parseRepoUrl('https://git.example.com:8443/acme/widgets'))
      .toMatchObject({ owner: 'acme' });
    expect(() => portBase.parseRepoUrl('https://git.example.com/acme/widgets'))
      .toThrow('scheme and port');
    // SSH compares only the host; the SSH port is not the HTTP origin port.
    expect(portBase.parseRepoUrl('ssh://git@git.example.com:2222/acme/widgets'))
      .toMatchObject({ host: 'git.example.com', protocol: 'ssh' });
  });

  it('validates access and reuses an existing review request', async () => {
    const review = {
      id: 1,
      number: 7,
      html_url: 'https://git.example.com/acme/widgets/pulls/7',
      head: { ref: 'vibecode/ticket-1-change' },
      state: 'open',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(200, { default_branch: 'main' }))
      .mockResolvedValueOnce(response(201, review))
      .mockResolvedValueOnce(response(409, { message: 'already exists' }))
      .mockResolvedValueOnce(response(200, [review]));
    const original = global.fetch;
    global.fetch = fetchMock;
    try {
      await expect(provider().validateRepoAccess('acme/widgets'))
        .resolves.toMatchObject({ accessible: true, defaultBranch: 'main' });
      const repo = { repoUrl: 'acme/widgets', defaultBranch: 'main' };
      const first = await provider().createReviewRequest(
        repo, 1, 'Change', 'vibecode/ticket-1-change', 'body');
      const second = await provider().createReviewRequest(
        repo, 1, 'Change', 'vibecode/ticket-1-change', 'body');

      expect(first).toEqual({
        id: 1,
        number: 7,
        url: 'https://git.example.com/acme/widgets/pulls/7',
        state: 'open',
      });
      expect(second).toEqual(first);
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('token token');
      expect(fetchMock.mock.calls[3][0]).toContain('pulls?state=open');
    } finally {
      global.fetch = original;
    }
  });

  it('reads a unified diff and manages branches', async () => {
    const diffText = [
      'diff --git a/src/a.js b/src/a.js',
      '--- a/src/a.js',
      '+++ b/src/a.js',
      '@@ -1 +1,2 @@',
      '-old',
      '+new',
      '+more',
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n');
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => diffText })
      .mockResolvedValueOnce(response(201, {}))
      .mockResolvedValueOnce(response(204, {}))
      .mockResolvedValueOnce(response(200, [{ name: 'vibecode/ticket-1-x' }, { name: 'main' }]));
    const original = global.fetch;
    global.fetch = fetchMock;
    try {
      const repo = { repoUrl: 'acme/widgets', defaultBranch: 'main' };
      const diff = await provider().getReviewDiff(repo, 7);
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/pulls\/7\.diff$/);
      expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/plain');
      expect(diff.prNumber).toBe(7);
      expect(diff.files).toHaveLength(2);
      expect(diff.files[0]).toMatchObject({
        filename: 'src/a.js', status: 'modified', additions: 2, deletions: 1, changes: 3,
      });
      expect(diff.files[0].patch).toContain('-old');
      expect(diff.files[1]).toMatchObject({
        filename: 'new.txt', status: 'added', additions: 1, deletions: 0,
      });
      await expect(provider().createBranch(repo, 1, 'Change'))
        .resolves.toBe('vibecode/ticket-1-change');
      await expect(provider().deleteBranch(repo, 'vibecode/ticket-1-change'))
        .resolves.toBeUndefined();
      await expect(provider().listBranches(repo)).resolves.toEqual(['vibecode/ticket-1-x']);
    } finally {
      global.fetch = original;
    }
  });

  it('keeps binary, deleted and renamed diff entries', async () => {
    const diffText = [
      'diff --git a/logo.png b/logo.png',
      'new file mode 100644',
      'index 0000000..1111111',
      'Binary files /dev/null and b/logo.png differ',
      'diff --git a/old.js b/old.js',
      'deleted file mode 100644',
      '--- a/old.js',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      'diff --git a/a.txt b/b.txt',
      'similarity index 100%',
      'rename from a.txt',
      'rename to b.txt',
      'diff --git "a/logo copy.png" "b/logo copy.png"',
      'new file mode 100644',
      'Binary files /dev/null and "b/logo copy.png" differ',
    ].join('\n');
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => diffText,
    });
    try {
      const diff = await provider().getReviewDiff(
        { repoUrl: 'acme/widgets', defaultBranch: 'main' }, 3);
      expect(diff.files).toHaveLength(4);
      expect(diff.files[0]).toMatchObject({
        filename: 'logo.png', status: 'added', additions: 0, deletions: 0, patch: '',
      });
      expect(diff.files[1]).toMatchObject({
        filename: 'old.js',
        status: 'removed',
        deletions: 1,
        patch: expect.stringContaining('-gone'),
      });
      expect(diff.files[2]).toMatchObject({ filename: 'b.txt', status: 'renamed' });
      expect(diff.files[3]).toMatchObject({
        filename: 'logo copy.png', status: 'added', patch: '',
      });
    } finally {
      global.fetch = original;
    }
  });

  it('parses text paths with spaces and escaped tabs', async () => {
    const diffText = [
      'diff --git a/notes 1795641559550.txt b/notes 1795641559550.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/notes 1795641559550.txt\t',
      '@@ -0,0 +1 @@',
      '+note',
      'diff --git "a/tab\\tname.txt" "b/tab\\tname.txt"',
      'new file mode 100644',
      '--- /dev/null',
      '+++ "b/tab\\tname.txt"',
      '@@ -0,0 +1 @@',
      '+tab',
    ].join('\n');
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => diffText,
    });
    try {
      const diff = await provider().getReviewDiff(
        { repoUrl: 'acme/widgets', defaultBranch: 'main' }, 5);
      expect(diff.files).toHaveLength(2);
      expect(diff.files[0]).toMatchObject({
        filename: 'notes 1795641559550.txt', additions: 1,
      });
      expect(diff.files[1]).toMatchObject({
        filename: 'tab\tname.txt', additions: 1,
      });
    } finally {
      global.fetch = original;
    }
  });

  it('lists open review requests only', async () => {
    const original = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([
        { id: 2, number: 9, html_url: 'open-pr', state: 'open',
          head: { ref: 'vibecode/ticket-2-y' } },
        { id: 3, number: 10, html_url: 'other', state: 'open', head: { ref: 'feature' } },
      ]),
    });
    try {
      await expect(provider().listReviewRequests({ repoUrl: 'acme/widgets' }))
        .resolves.toEqual([{ id: 2, number: 9, url: 'open-pr', state: 'open' }]);
      expect(global.fetch.mock.calls[0][0]).toContain('pulls?state=open');
    } finally {
      global.fetch = original;
    }
  });
});
