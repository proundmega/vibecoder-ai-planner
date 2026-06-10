const GitHubService = require('../services/GitHubService');
const { GitHubProvider } = require('../providers/github');
const { encrypt, decrypt } = require('../utils/crypto');

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn(),
}));
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../models/ticket');
jest.mock('../providers/github', () => {
  const GitHubProvider = jest.fn().mockImplementation(() => ({}));
  GitHubProvider.validateRepoAccess = jest.fn();
  GitHubProvider.parseRepoUrl = jest.fn((url) => {
    const parts = url.split('/');
    return { owner: parts[0], repo: parts[1] };
  });
  return { GitHubProvider };
});
jest.mock('../utils/crypto');
jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

const Project = require('../models/project');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');

describe('GitHubService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    encrypt.mockReturnValue('encrypted-token-xyz');
    decrypt.mockReturnValue('real-token');
  });

  describe('connectProject', () => {
    it('should connect a repository with valid PAT', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      User.find.mockResolvedValue({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValue(true);
      GitHubProvider.validateRepoAccess = jest.fn().mockResolvedValue({
        accessible: true,
        defaultBranch: 'main',
        private: false,
        error: null,
      });
      pool.query.mockResolvedValue({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'github',
          repo_url: 'owner/repo',
          access_token_encrypted: 'encrypted-token-xyz',
          default_branch: 'main',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const result = await GitHubService.connectProject(1, 'owner/repo', 'test-token', 100);

      expect(encrypt).toHaveBeenCalledWith('test-token');
      expect(GitHubProvider.validateRepoAccess).toHaveBeenCalledWith('test-token', 'owner', 'repo');
      expect(pool.query).toHaveBeenCalled();
      expect(result.repoUrl).toBe('owner/repo');
    });

    it('should throw ValidationError if PAT validation fails', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      User.find.mockResolvedValue({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValue(true);
      GitHubProvider.validateRepoAccess = jest.fn().mockResolvedValue({
        accessible: false,
        defaultBranch: null,
        private: null,
        error: 'Repository not found',
      });

      await expect(
        GitHubService.connectProject(1, 'owner/repo', 'bad-token', 100)
      ).rejects.toThrow('Cannot access repository: Repository not found');
    });

    it('should throw ForbiddenError if user is not project admin', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      User.find.mockResolvedValue({ role: 'user' });
      PermissionService.hasPermission.mockResolvedValue(false);

      await expect(
        GitHubService.connectProject(1, 'owner/repo', 'test-token', 200)
      ).rejects.toThrow('Only project owner or admin can connect a repository');
    });

    it('should throw NotFoundError if project does not exist', async () => {
      Project.findById.mockResolvedValue(null);

      await expect(
        GitHubService.connectProject(999, 'owner/repo', 'test-token', 100)
      ).rejects.toThrow('Project not found');
    });
  });

  describe('disconnectProject', () => {
    it('should deactivate the repository connection', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitHubService.disconnectProject(1);

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE project_repos SET is_active = FALSE, updated_at = NOW() WHERE project_id = $1',
        [1]
      );
      expect(result.success).toBe(true);
    });

    it('should throw NotFoundError if project does not exist', async () => {
      Project.findById.mockResolvedValue(null);

      await expect(GitHubService.disconnectProject(999)).rejects.toThrow('Project not found');
    });
  });

  describe('getProjectRepo', () => {
    it('should return repo if connected', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      pool.query.mockResolvedValue({
        rows: [{
          id: 1,
          project_id: 1,
          provider: 'github',
          repo_url: 'owner/repo',
          access_token_encrypted: 'encrypted',
          default_branch: 'main',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const result = await GitHubService.getProjectRepo(1);

      expect(result).not.toBeNull();
      expect(result.repoUrl).toBe('owner/repo');
    });

    it('should return null if no repo connected', async () => {
      Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitHubService.getProjectRepo(1);

      expect(result).toBeNull();
    });
  });

  describe('createTicketBranch', () => {
    it('should create a branch and update ticket', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      const repo = {
        id: 1,
        projectId: 1,
        provider: 'github',
        repoUrl: 'owner/repo',
        defaultBranch: 'main',
        isActive: true,
        accessTokenEncrypted: 'encrypted-token',
      };
      jest.spyOn(GitHubService, 'getProjectRepo').mockResolvedValue(repo);

      const Ticket = require('../models/ticket');
      Ticket.findById.mockResolvedValue({
        id: 42,
        projectId: 1,
        title: 'Fix authentication bug',
        branchName: null,
      });

      const mockProvider = { createBranch: jest.fn().mockResolvedValue('vibecode/ticket-42-fix-authentication-bug') };
      GitHubProvider.mockReturnValue(mockProvider);
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitHubService.createTicketBranch(1, 42);

      expect(mockProvider.createBranch).toHaveBeenCalled();
      expect(result.branchName).toBe('vibecode/ticket-42-fix-authentication-bug');
    });

    it('should throw ValidationError if no repo connected', async () => {
      jest.spyOn(GitHubService, 'getProjectRepo').mockResolvedValue(null);

      await expect(GitHubService.createTicketBranch(1, 42)).rejects.toThrow(
        'No repository connected to this project'
      );
    });
  });

  describe('createTicketPR', () => {
    it('should create a PR and update ticket', async () => {
      const repo = {
        id: 1,
        projectId: 1,
        provider: 'github',
        repoUrl: 'owner/repo',
        defaultBranch: 'main',
        isActive: true,
        accessTokenEncrypted: 'encrypted-token',
      };
      jest.spyOn(GitHubService, 'getProjectRepo').mockResolvedValue(repo);

      const Ticket = require('../models/ticket');
      Ticket.findById.mockResolvedValue({
        id: 42,
        projectId: 1,
        title: 'Fix authentication bug',
        branchName: 'vibecode/ticket-42-fix-authentication-bug',
        description: 'Fix the auth bug',
      });

      const mockProvider = {
        createPR: jest.fn().mockResolvedValue({
          id: 100,
          url: 'https://github.com/owner/repo/pull/1',
          number: 1,
          state: 'open',
          head: 'vibecode/ticket-42-fix-authentication-bug',
          base: 'main',
        }),
      };
      GitHubProvider.mockReturnValue(mockProvider);
      pool.query.mockResolvedValue({ rows: [] });

      const result = await GitHubService.createTicketPR(1, 42, null);

      expect(result.url).toBe('https://github.com/owner/repo/pull/1');
      expect(result.state).toBe('open');
    });

    it('should throw ValidationError if no branch exists', async () => {
      const repo = {
        id: 1,
        projectId: 1,
        provider: 'github',
        repoUrl: 'owner/repo',
        defaultBranch: 'main',
        isActive: true,
        accessTokenEncrypted: 'encrypted-token',
      };
      jest.spyOn(GitHubService, 'getProjectRepo').mockResolvedValue(repo);

      const Ticket = require('../models/ticket');
      Ticket.findById.mockResolvedValue({
        id: 42,
        projectId: 1,
        title: 'Fix auth bug',
        branchName: null,
      });

      await expect(GitHubService.createTicketPR(1, 42, null)).rejects.toThrow(
        'No branch created for this ticket yet'
      );
    });
  });
});
