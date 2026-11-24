jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../models/project');
jest.mock('../models/ticket');
jest.mock('../models/user');
jest.mock('../services/PermissionService', () => ({ hasPermission: jest.fn() }));
jest.mock('../services/GitHubAppAuthService', () => ({
  getAuthMode: jest.fn(),
  isPatAllowed: jest.fn(),
  assertProjectEnabled: jest.fn(),
  mintToken: jest.fn(),
  clearCacheForProject: jest.fn(),
}));
jest.mock('../utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('../utils/logger', () => ({ warn: jest.fn(), error: jest.fn() }));

const GitProjectService = require('../services/GitProjectService');
const { pool } = require('../db');
const Project = require('../models/project');
const Ticket = require('../models/ticket');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const GitHubAppAuthService = require('../services/GitHubAppAuthService');
const { encrypt, decrypt } = require('../utils/crypto');
const gitProviders = require('../providers/git');

function fakeProvider(overrides = {}) {
  return {
    parseRepoUrl: jest.fn().mockReturnValue({ owner: 'group', repo: 'repo' }),
    validateRepoAccess: jest.fn().mockResolvedValue({
      accessible: true,
      defaultBranch: 'main',
    }),
    ...overrides,
  };
}

describe('GitProjectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
    User.find.mockResolvedValue({ role: 'project_admin' });
    PermissionService.hasPermission.mockResolvedValue(true);
    Ticket.findById.mockResolvedValue({
      id: 42,
      projectId: 1,
      title: 'Title',
      description: 'Desc',
      branchName: 'vibecode/ticket-42-title',
      prUrl: 'https://example.test/pull/7',
    });
    GitHubAppAuthService.getAuthMode.mockReturnValue('pat');
    GitHubAppAuthService.isPatAllowed.mockReturnValue(true);
    GitHubAppAuthService.assertProjectEnabled.mockResolvedValue(undefined);
    encrypt.mockImplementation(value => `enc:${value}`);
    decrypt.mockImplementation(value => String(value).replace(/^enc:/, ''));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('connect', () => {
    it('stores provider metadata and encrypts the credential', async () => {
      const provider = fakeProvider();
      jest.spyOn(gitProviders.registry, 'get').mockReturnValue(provider);
      jest.spyOn(gitProviders, 'assertSafeBaseUrl').mockResolvedValue('https://git.example.com');
      pool.query.mockResolvedValue({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'forgejo',
          repo_url: 'https://git.example.com/group/repo',
          access_token_encrypted: 'enc:secret',
          default_branch: 'main',
          is_active: true,
          provider_base_url: 'https://git.example.com',
          auth_mode: 'pat',
        }],
      });

      const result = await GitProjectService.connect(1, {
        provider: 'forgejo',
        repoUrl: 'https://git.example.com/group/repo',
        baseUrl: 'https://git.example.com',
        token: 'secret',
        authMode: 'pat',
      }, 100);

      expect(gitProviders.assertSafeBaseUrl).toHaveBeenCalledWith('https://git.example.com');
      expect(encrypt).toHaveBeenCalledWith('secret');
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO project_repos');
      expect(params).toEqual([
        1,
        'forgejo',
        'https://git.example.com/group/repo',
        'enc:secret',
        'main',
        'https://git.example.com',
        null,
        'pat',
        null,
      ]);
      expect(result.provider).toBe('forgejo');
      expect(result.providerBaseUrl).toBe('https://git.example.com');
      expect(result.accessToken).toBeUndefined();
    });

    it('stores an encrypted SSH key for local providers', async () => {
      const provider = fakeProvider();
      jest.spyOn(gitProviders.registry, 'get').mockReturnValue(provider);
      pool.query.mockResolvedValue({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'local',
          repo_url: 'ssh://git@git.example.com/group/repo.git',
          ssh_key_encrypted: 'enc:key',
          default_branch: 'main',
          is_active: true,
          auth_mode: 'ssh',
        }],
      });

      await GitProjectService.connect(1, {
        provider: 'local',
        repoUrl: 'ssh://git@git.example.com/group/repo.git',
        sshKey: 'key',
        authMode: 'ssh',
      }, 100);

      expect(encrypt).toHaveBeenCalledWith('key');
      expect(pool.query.mock.calls[0][1][3]).toBeNull();
      expect(pool.query.mock.calls[0][1][8]).toBe('enc:key');
    });

    it('rejects unknown providers, auth modes and missing credentials', async () => {
      await expect(GitProjectService.connect(1, {
        provider: 'bitbucket', repoUrl: 'x', token: 't',
      }, 100)).rejects.toThrow('Unsupported Git provider');

      await expect(GitProjectService.connect(1, {
        provider: 'forgejo', repoUrl: 'x', token: 't', authMode: 'app',
      }, 100)).rejects.toThrow('Unsupported auth mode');

      await expect(GitProjectService.connect(1, {
        provider: 'forgejo', repoUrl: 'x', authMode: 'pat',
      }, 100)).rejects.toThrow('A token is required');

      await expect(GitProjectService.connect(1, {
        provider: 'local', repoUrl: 'x', authMode: 'ssh',
      }, 100)).rejects.toThrow('An SSH key is required');
    });

    it('rejects a repository the credential cannot access', async () => {
      const provider = fakeProvider({
        validateRepoAccess: jest.fn().mockResolvedValue({
          accessible: false,
          error: 'Repository not found',
        }),
      });
      jest.spyOn(gitProviders.registry, 'get').mockReturnValue(provider);

      await expect(GitProjectService.connect(1, {
        provider: 'forgejo', repoUrl: 'https://git.example.com/group/repo', token: 't',
      }, 100)).rejects.toThrow('Cannot access repository: Repository not found');
    });
  });

  describe('getAgentCredential', () => {
    it('returns no PAT in GitHub App mode', async () => {
      GitHubAppAuthService.getAuthMode.mockReturnValue('app');
      pool.query.mockResolvedValue({
        rows: [{
          provider: 'github',
          repo_url: 'https://github.com/o/r',
          access_token_encrypted: 'enc:pat',
        }],
      });

      await expect(GitProjectService.getAgentCredential(1)).resolves.toEqual({
        repoUrl: 'https://github.com/o/r',
        accessToken: null,
        authMode: 'app',
      });
    });

    it('returns the decrypted GitHub PAT in PAT mode', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          provider: 'github',
          repo_url: 'https://github.com/o/r',
          access_token_encrypted: 'enc:pat',
        }],
      });

      await expect(GitProjectService.getAgentCredential(1)).resolves.toEqual({
        repoUrl: 'https://github.com/o/r',
        accessToken: 'pat',
        authMode: 'pat',
      });
    });

    it('returns a self-hosted token and base URL', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          provider: 'forgejo',
          repo_url: 'https://git.example.com/group/repo',
          provider_base_url: 'https://git.example.com',
          access_token_encrypted: 'enc:token',
          auth_mode: 'pat',
        }],
      });

      await expect(GitProjectService.getAgentCredential(1)).resolves.toMatchObject({
        provider: 'forgejo',
        repoUrl: 'https://git.example.com/group/repo',
        providerBaseUrl: 'https://git.example.com',
        accessToken: 'token',
        sshKey: null,
        authMode: 'pat',
      });
    });

    it('returns the decrypted SSH key for local providers', async () => {
      pool.query.mockResolvedValue({
        rows: [{
          provider: 'local',
          repo_url: 'ssh://git@git.example.com/group/repo.git',
          ssh_key_encrypted: 'enc:key',
          auth_mode: 'ssh',
        }],
      });

      await expect(GitProjectService.getAgentCredential(1)).resolves.toMatchObject({
        provider: 'local',
        accessToken: null,
        sshKey: 'key',
        authMode: 'ssh',
      });
    });
  });

  describe('provider operations', () => {
    it('creates a branch through the registered provider', async () => {
      const provider = fakeProvider({
        createBranch: jest.fn().mockResolvedValue('vibecode/ticket-42-title'),
      });
      jest.spyOn(gitProviders.registry, 'get').mockReturnValue(provider);
      Ticket.findById.mockResolvedValue({
        id: 42, projectId: 1, title: 'Title', branchName: null,
      });
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitProjectService.createBranch(1, 42, {
        repo: {
          provider: 'github',
          repoUrl: 'owner/repo',
          accessTokenEncrypted: 'enc:pat',
        },
      });

      expect(provider.createBranch).toHaveBeenCalledWith(
        expect.objectContaining({ repoUrl: 'owner/repo' }), 42, 'Title');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tickets SET branch_name'),
        ['vibecode/ticket-42-title', 42]
      );
      expect(result.branchName).toBe('vibecode/ticket-42-title');
    });

    it('creates a review request and records the PR URL', async () => {
      const provider = fakeProvider({
        createReviewRequest: jest.fn().mockResolvedValue({
          url: 'https://example.test/pull/1',
          state: 'open',
        }),
      });
      jest.spyOn(gitProviders.registry, 'get').mockReturnValue(provider);
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitProjectService.createReviewRequest(1, 42, null, {
        repo: {
          provider: 'github',
          repoUrl: 'owner/repo',
          accessTokenEncrypted: 'enc:pat',
        },
      });

      expect(provider.createReviewRequest).toHaveBeenCalledWith(
        expect.objectContaining({ repoUrl: 'owner/repo' }),
        42,
        'Title',
        'vibecode/ticket-42-title',
        'Desc'
      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET pr_url = $1'),
        ['https://example.test/pull/1', 'open', 42]
      );
      expect(result.url).toBe('https://example.test/pull/1');
    });

    it('returns branch-only evidence when the provider has no review request', async () => {
      const provider = fakeProvider({
        createReviewRequest: jest.fn().mockResolvedValue(null),
      });
      jest.spyOn(gitProviders.registry, 'get').mockReturnValue(provider);
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitProjectService.createReviewRequest(1, 42, null, {
        repo: {
          provider: 'github',
          repoUrl: 'owner/repo',
          accessTokenEncrypted: 'enc:pat',
        },
      });

      expect(result).toEqual({ ticketId: 42, branchName: 'vibecode/ticket-42-title' });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
