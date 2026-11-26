const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));
jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
  hasPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: 'user-1', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));
jest.mock('../services/GitProjectService', () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  getRepo: jest.fn(),
  getRepos: jest.fn(),
  getAgentCredential: jest.fn(),
  createBranch: jest.fn(),
  deleteBranch: jest.fn(),
  listBranches: jest.fn(),
  listReviewRequests: jest.fn(),
  createReviewRequest: jest.fn(),
  getReviewDiff: jest.fn(),
}));
jest.mock('../models/project');
jest.mock('../models/ticket');

const app = require('../index');
const GitProjectService = require('../services/GitProjectService');
const PermissionService = require('../services/PermissionService');
const Project = require('../models/project');
const Ticket = require('../models/ticket');

function asUser(userId = 'user-1', role = 'project_admin') {
  jwt.verify.mockReturnValue({ userId, role });
}

function auth(req) {
  return req.set('Authorization', 'Bearer mock-token');
}

describe('Generic Git routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asUser();
    PermissionService.hasAnyPermission.mockResolvedValue(true);
    Project.findById.mockResolvedValue({ id: 1, ownerId: 'user-1' });
    Ticket.findById.mockResolvedValue({ id: 42, projectId: 1 });
  });

  it('lists registered providers and their capabilities', async () => {
    const res = await auth(request(app).get('/api/v1/git/providers'));

    expect(res.statusCode).toBe(200);
    const ids = res.body.data.map(provider => provider.id);
    expect(ids).toEqual(expect.arrayContaining(['github', 'forgejo', 'gitea', 'local']));
    expect(res.body.data.find(provider => provider.id === 'forgejo'))
      .toMatchObject({ requiresBaseUrl: true, supportsReviewRequests: true });
  });

  it('connects a Forgejo repository through the generic route', async () => {
    GitProjectService.connect.mockResolvedValue({
      id: 1,
      provider: 'forgejo',
      repoUrl: 'https://git.example.com/group/repo.git',
    });

    const body = {
      provider: 'forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      authMode: 'pat',
      token: 'secret',
    };
    const res = await auth(request(app).post('/api/v1/git/1/repo/connect')).send(body);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.provider).toBe('forgejo');
    expect(GitProjectService.connect).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ provider: 'forgejo', repoUrl: 'group/repo' }),
      'user-1'
    );
  });

  it('accepts accessToken as the GitHub token alias', async () => {
    GitProjectService.connect.mockResolvedValue({ provider: 'github' });

    const res = await auth(request(app).post('/api/v1/git/1/repo/connect')).send({
      provider: 'github',
      repoUrl: 'owner/repo',
      accessToken: 'ghp_secret',
    });

    expect(res.statusCode).toBe(201);
    const input = GitProjectService.connect.mock.calls[0][1];
    expect(input.token).toBe('ghp_secret');
    expect(input.accessToken).toBeUndefined();
  });

  it('normalizes provider casing before the service', async () => {
    GitProjectService.connect.mockResolvedValue({ provider: 'forgejo' });

    const res = await auth(request(app).post('/api/v1/git/1/repo/connect')).send({
      provider: 'Forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      authMode: 'PAT',
      token: 'secret',
    });

    expect(res.statusCode).toBe(201);
    expect(GitProjectService.connect.mock.calls[0][1])
      .toMatchObject({ provider: 'forgejo', authMode: 'pat' });
  });

  it('lets a project admin who is not the owner connect', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 'someone-else' });
    GitProjectService.connect.mockResolvedValue({ provider: 'forgejo' });

    const res = await auth(request(app).post('/api/v1/git/1/repo/connect')).send({
      provider: 'forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      token: 'secret',
    });

    expect(res.statusCode).toBe(201);
    expect(GitProjectService.connect).toHaveBeenCalled();
  });

  it('lets a super admin connect a project they do not own', async () => {
    asUser('user-2', 'super_admin');
    Project.findById.mockResolvedValue({ id: 1, ownerId: 'someone-else' });
    GitProjectService.connect.mockResolvedValue({ provider: 'forgejo' });

    const res = await auth(request(app).post('/api/v1/git/1/repo/connect')).send({
      provider: 'forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      token: 'secret',
    });

    expect(res.statusCode).toBe(201);
  });

  it('rejects connect without the manage-members permission', async () => {
    PermissionService.hasAnyPermission.mockResolvedValue(false);

    const res = await auth(request(app).post('/api/v1/git/1/repo/connect')).send({
      provider: 'forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      token: 'secret',
    });

    expect(res.statusCode).toBe(403);
    expect(GitProjectService.connect).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-number',
    '1e2',
    '1.0',
    '+1',
    '0',
    '9223372036854775808',
    '99999999999999999999',
  ])(
    'rejects a malformed project id %s before the service',
    async (id) => {
      const res = await auth(request(app).get(`/api/v1/git/${id}/repo`));

      expect(res.statusCode).toBe(400);
      expect(GitProjectService.getRepo).not.toHaveBeenCalled();
    }
  );

  it('rejects a malformed ticket id before the ticket lookup', async () => {
    const res = await auth(request(app).post('/api/v1/git/1.0/branch'))
      .send({ provider: 'forgejo' });

    expect(res.statusCode).toBe(400);
    expect(Ticket.findById).not.toHaveBeenCalled();
    expect(GitProjectService.createBranch).not.toHaveBeenCalled();
  });

  it('rejects a connect request without a repository URL', async () => {
    const res = await auth(request(app).post('/api/v1/git/1/repo/connect'))
      .send({ provider: 'forgejo' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(GitProjectService.connect).not.toHaveBeenCalled();
  });

  it('scopes repository status to the requested provider', async () => {
    GitProjectService.getRepo.mockResolvedValue({ provider: 'gitea' });

    const res = await auth(request(app).get('/api/v1/git/1/repo?provider=gitea'));

    expect(res.statusCode).toBe(200);
    expect(GitProjectService.getRepo).toHaveBeenCalledWith('1', { provider: 'gitea' });
  });

  it('lists and disconnects repositories by provider', async () => {
    GitProjectService.getRepos.mockResolvedValue([{ provider: 'forgejo' }]);
    GitProjectService.disconnect.mockResolvedValue({ success: true });

    const listed = await auth(request(app).get('/api/v1/git/1/repos'));
    const removed = await auth(request(app).delete('/api/v1/git/1/repo?provider=forgejo'));

    expect(listed.statusCode).toBe(200);
    expect(GitProjectService.getRepos).toHaveBeenCalledWith('1', { provider: null });
    expect(removed.statusCode).toBe(200);
    expect(GitProjectService.disconnect).toHaveBeenCalledWith('1', { provider: 'forgejo' });
  });

  it('lists branches and reviews for the connected provider', async () => {
    GitProjectService.listBranches.mockResolvedValue(['vibecode/ticket-1-x']);
    GitProjectService.listReviewRequests.mockResolvedValue([{ number: 3 }]);

    const branches = await auth(request(app).get('/api/v1/git/1/branches'));
    const reviews = await auth(request(app).get('/api/v1/git/1/reviews?provider=forgejo'));

    expect(branches.statusCode).toBe(200);
    expect(branches.body.data).toEqual(['vibecode/ticket-1-x']);
    expect(reviews.statusCode).toBe(200);
    expect(GitProjectService.listReviewRequests)
      .toHaveBeenCalledWith('1', { provider: 'forgejo' });
  });

  it('resolves the project from the ticket for branch and review operations', async () => {
    GitProjectService.createBranch.mockResolvedValue({ ticketId: 't1' });
    GitProjectService.deleteBranch.mockResolvedValue({ success: true });
    GitProjectService.createReviewRequest.mockResolvedValue({ url: 'pr', ticketId: 't1' });
    GitProjectService.getReviewDiff.mockResolvedValue({ files: [], prNumber: 3 });

    const created = await auth(request(app).post('/api/v1/git/42/branch'))
      .send({ provider: 'forgejo' });
    const review = await auth(request(app).post('/api/v1/git/42/review'))
      .send({ provider: 'forgejo', description: 'desc' });
    const diff = await auth(request(app).get('/api/v1/git/42/review/diff'));
    const removed = await auth(request(app).delete('/api/v1/git/42/branch'));

    expect(created.statusCode).toBe(201);
    expect(GitProjectService.createBranch).toHaveBeenCalledWith(
      1, '42', { provider: 'forgejo' });
    expect(review.statusCode).toBe(201);
    expect(GitProjectService.createReviewRequest).toHaveBeenCalledWith(
      1, '42', 'desc', { provider: 'forgejo' });
    expect(diff.statusCode).toBe(200);
    expect(GitProjectService.getReviewDiff).toHaveBeenCalledWith(
      1, '42', { provider: null });
    expect(removed.statusCode).toBe(200);
    expect(GitProjectService.deleteBranch).toHaveBeenCalledWith(
      1, '42', { provider: null });
  });

  it('rejects disconnect without the manage-members permission', async () => {
    PermissionService.hasAnyPermission.mockResolvedValue(false);

    const res = await auth(request(app).delete('/api/v1/git/1/repo?provider=forgejo'));

    expect(res.statusCode).toBe(403);
    expect(GitProjectService.disconnect).not.toHaveBeenCalled();
  });

  it('lets a super admin read a project they do not own', async () => {
    asUser('user-2', 'super_admin');
    Project.findById.mockResolvedValue({ id: 1, ownerId: 'someone-else' });
    GitProjectService.getRepo.mockResolvedValue({ provider: 'forgejo' });

    const res = await auth(request(app).get('/api/v1/git/1/repo'));

    expect(res.statusCode).toBe(200);
    expect(GitProjectService.getRepo).toHaveBeenCalledWith('1', { provider: null });
  });

  it('rejects a caller who does not own the project', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 'someone-else' });

    const res = await auth(request(app).get('/api/v1/git/1/repo'));

    expect(res.statusCode).toBe(403);
    expect(GitProjectService.getRepo).not.toHaveBeenCalled();
  });

  it('serves the provider-scoped credential through the agent route', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 1 });
    const credential = {
      repoUrl: 'owner/repo',
      accessToken: null,
      authMode: 'app',
    };
    GitProjectService.getAgentCredential.mockResolvedValue(credential);

    const res = await request(app)
      .get('/api/v1/git/1/repo/agent')
      .set('X-API-Key', 'test-agent-key');

    expect(res.statusCode).toBe(200);
    expect(GitProjectService.getAgentCredential)
      .toHaveBeenCalledWith('1', { provider: null });
    expect(res.body.data).toEqual({ provider: 'github', ...credential });
  });
});
