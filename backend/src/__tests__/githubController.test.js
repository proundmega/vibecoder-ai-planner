const githubController = require('../controllers/githubController');
const GitHubService = require('../services/GitHubService');

jest.mock('../services/GitHubService');
jest.mock('../models/ticket');

describe('GitHub Controller', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockReq = {
      params: {},
      body: {},
      user: { userId: 'user-1', role: 'project_admin' },
    };
  });

  describe('connectRepo', () => {
    it('should connect a repository with 201 status', async () => {
      const repo = { id: 1, repoUrl: 'owner/repo', defaultBranch: 'main' };
      GitHubService.connectProject.mockResolvedValue(repo);

      mockReq.params.id = '1';
      mockReq.body = { repoUrl: 'owner/repo', accessToken: 'ghp_token123' };

      await githubController.connectRepo(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: repo });
      expect(GitHubService.connectProject).toHaveBeenCalledWith(
        '1', 'owner/repo', 'ghp_token123', 'user-1'
      );
    });
  });

  describe('disconnectRepo', () => {
    it('should disconnect a repository', async () => {
      GitHubService.disconnectProject.mockResolvedValue({ success: true });

      mockReq.params.id = '1';

      await githubController.disconnectRepo(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Repository disconnected' },
      });
      expect(GitHubService.disconnectProject).toHaveBeenCalledWith('1');
    });
  });

  describe('getRepoStatus', () => {
    it('should return repo status', async () => {
      const repo = { id: 1, repoUrl: 'owner/repo', isActive: true };
      GitHubService.getProjectRepo.mockResolvedValue(repo);

      mockReq.params.id = '1';

      await githubController.getRepoStatus(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: repo });
    });

    it('should return null if no repo connected', async () => {
      GitHubService.getProjectRepo.mockResolvedValue(null);

      mockReq.params.id = '1';

      await githubController.getRepoStatus(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: null });
    });
  });

  describe('createBranch', () => {
    it('should create a branch with 201 status', async () => {
      const result = { branchName: 'vibecode/ticket-42-fix-bug', ticketId: '42' };
      GitHubService.createTicketBranch.mockResolvedValue(result);

      mockReq.params.ticketId = '42';
      mockReq.body = { projectId: '1' };

      await githubController.createBranch(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: result });
    });

    it('should use projectId from body when provided', async () => {
      const result = { branchName: 'vibecode/ticket-42-fix-bug', ticketId: '42' };
      GitHubService.createTicketBranch.mockResolvedValue(result);

      mockReq.params.ticketId = '42';
      mockReq.body = { projectId: '5' };

      await githubController.createBranch(mockReq, mockRes, nextFn);

      expect(GitHubService.createTicketBranch).toHaveBeenCalledWith('5', '42');
    });
  });

  describe('createPR', () => {
    it('should create a PR with 201 status', async () => {
      const result = { url: 'https://github.com/owner/repo/pull/1', state: 'open' };
      GitHubService.createTicketPR.mockResolvedValue(result);

      mockReq.params.ticketId = '42';
      mockReq.body = { projectId: '1', description: 'Testing the PR' };

      await githubController.createPR(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: result });
    });
  });

  describe('deleteBranch', () => {
    it('should delete a branch', async () => {
      GitHubService.deleteTicketBranch.mockResolvedValue({ success: true });

      mockReq.params.ticketId = '42';
      mockReq.body = { projectId: '1' };

      await githubController.deleteBranch(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { success: true },
      });
    });
  });

  describe('listBranches', () => {
    it('should list all ticket branches', async () => {
      const branches = ['vibecode/ticket-42-fix-bug', 'vibecode/ticket-43-add-feature'];
      GitHubService.listTicketBranches.mockResolvedValue(branches);

      mockReq.params.projectId = '1';

      await githubController.listBranches(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: branches });
    });
  });

  describe('listPRs', () => {
    it('should list all ticket PRs', async () => {
      const prs = [
        { id: 1, url: 'https://github.com/owner/repo/pull/1', state: 'open' },
      ];
      GitHubService.listTicketPRs.mockResolvedValue(prs);

      mockReq.params.projectId = '1';

      await githubController.listPRs(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: prs });
    });
  });
});
