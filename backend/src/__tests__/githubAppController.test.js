const githubController = require('../controllers/githubController');
const Project = require('../models/project');
const GitHubAppAuthService = require('../services/GitHubAppAuthService');

jest.mock('../models/project');
jest.mock('../services/GitHubAppAuthService');
jest.mock('../services/GitHubService', () => ({}));

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const nextFn = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('githubController.requestToken (fg-35 FR4/FR10)', () => {
  it('returns a scoped token to the project owner agent', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
    GitHubAppAuthService.mintToken.mockResolvedValue({
      token: 'ghs_scoped',
      expiresAt: '2026-11-14T01:00:00.000Z',
      mode: 'app',
      repo: 'acme/widgets',
    });
    const req = {
      params: { projectId: '1' },
      body: { operation: 'clone' },
      agent: { id: 10, owner_id: 7 },
    };
    const res = mockRes();

    await githubController.requestToken(req, res, nextFn);

    expect(GitHubAppAuthService.mintToken).toHaveBeenCalledWith(1, {
      operation: 'clone',
      repo: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ token: 'ghs_scoped' }),
    });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('rejects an agent owned by a different user', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
    const req = {
      params: { projectId: '1' },
      body: {},
      agent: { id: 10, owner_id: 9 },
    };
    const res = mockRes();

    await githubController.requestToken(req, res, nextFn);

    expect(GitHubAppAuthService.mintToken).not.toHaveBeenCalled();
    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('allows a super admin JWT user', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 7 });
    GitHubAppAuthService.mintToken.mockResolvedValue({ token: 'ghs_scoped' });
    const req = {
      params: { projectId: '1' },
      body: {},
      user: { userId: 9, role: 'super_admin' },
    };
    const res = mockRes();

    await githubController.requestToken(req, res, nextFn);

    expect(GitHubAppAuthService.mintToken).toHaveBeenCalled();
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown project', async () => {
    Project.findById.mockResolvedValue(null);
    const req = { params: { projectId: '99' }, body: {}, agent: { owner_id: 1 } };
    const res = mockRes();

    await githubController.requestToken(req, res, nextFn);

    expect(nextFn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 })
    );
  });
});

describe('githubController installation management (fg-35 FR2/FR7)', () => {
  it('returns the installation mapping', async () => {
    GitHubAppAuthService.getInstallationStatus.mockResolvedValue({
      projectId: 1,
      installationId: 42,
      repoAllowlist: ['acme/widgets'],
      disabled: false,
    });
    const req = { params: { projectId: '1' } };
    const res = mockRes();

    await githubController.getInstallationStatus(req, res, nextFn);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ installationId: 42 }),
    });
  });

  it('sets the installation mapping', async () => {
    GitHubAppAuthService.setInstallation.mockResolvedValue({
      projectId: 1,
      installationId: 42,
      repoAllowlist: ['acme/widgets'],
      disabled: false,
    });
    const req = {
      params: { projectId: '1' },
      body: { installationId: 42, repoAllowlist: ['acme/widgets'] },
    };
    const res = mockRes();

    await githubController.setInstallation(req, res, nextFn);

    expect(GitHubAppAuthService.setInstallation).toHaveBeenCalledWith(
      1,
      42,
      ['acme/widgets']
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.any(Object) });
  });

  it('disables GitHub access', async () => {
    GitHubAppAuthService.disableProject.mockResolvedValue({
      disabled: true,
      revoked: true,
    });
    const req = { params: { projectId: '1' } };
    const res = mockRes();

    await githubController.disableInstallation(req, res, nextFn);

    expect(GitHubAppAuthService.disableProject).toHaveBeenCalledWith(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { disabled: true, revoked: true },
    });
  });
});
