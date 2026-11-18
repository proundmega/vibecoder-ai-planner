const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');
const PermissionService = require('../services/PermissionService');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  maskToken: jest.fn(),
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

describe('Agent key management authorization', () => {
  let findByIdSpy;
  let rotateSpy;
  let revokeSpy;
  let deleteSpy;

  function asUser(userId, role) {
    jwt.verify.mockReturnValue({ userId, email: 'user@test.com', role });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService.hasAnyPermission.mockResolvedValue(true);
    findByIdSpy = jest.spyOn(AgentService, 'findById').mockResolvedValue({
      id: 'a1',
      name: 'Shared Agent',
      owner_id: 'owner-1',
    });
    rotateSpy = jest.spyOn(AgentService, 'rotateKey').mockResolvedValue({
      id: 'a1',
      name: 'Shared Agent',
      api_key: 'ak_rotated',
      api_key_expires_at: new Date('2027-01-01T00:00:00Z'),
    });
    revokeSpy = jest.spyOn(AgentService, 'revokeApiKey').mockResolvedValue(undefined);
    deleteSpy = jest.spyOn(AgentService, 'delete').mockResolvedValue(undefined);
  });

  afterEach(() => {
    findByIdSpy.mockRestore();
    rotateSpy.mockRestore();
    revokeSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it('allows a project_admin to rotate an agent it owns', async () => {
    asUser('owner-1', 'project_admin');

    const res = await request(app)
      .post('/api/v1/agents/a1/rotate-key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(rotateSpy).toHaveBeenCalledWith('a1');
    expect(res.body.data.newApiKey).toBe('ak_rotated');
  });

  it('allows a super_admin to rotate another owner’s agent', async () => {
    asUser('admin-1', 'super_admin');

    const res = await request(app)
      .post('/api/v1/agents/a1/rotate-key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(rotateSpy).toHaveBeenCalledWith('a1');
  });

  it('returns 404 when a project_admin rotates an agent it does not own', async () => {
    asUser('other-1', 'project_admin');

    const res = await request(app)
      .post('/api/v1/agents/a1/rotate-key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(404);
    expect(rotateSpy).not.toHaveBeenCalled();
  });

  it('returns 403 when the user lacks AGENT_REVOKE', async () => {
    asUser('owner-1', 'member');
    PermissionService.hasAnyPermission.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/v1/agents/a1/rotate-key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(403);
    expect(rotateSpy).not.toHaveBeenCalled();
  });

  it('allows a super_admin to revoke another owner’s key', async () => {
    asUser('admin-1', 'super_admin');

    const res = await request(app)
      .post('/api/v1/agents/revoke/a1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(revokeSpy).toHaveBeenCalledWith('a1');
  });

  it('returns 404 when a project_admin revokes another owner’s key', async () => {
    asUser('other-1', 'project_admin');

    const res = await request(app)
      .post('/api/v1/agents/revoke/a1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(404);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('allows a project_admin to delete an agent it owns', async () => {
    asUser('owner-1', 'project_admin');

    const res = await request(app)
      .delete('/api/v1/agents/a1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(deleteSpy).toHaveBeenCalledWith('a1');
  });

  it('allows a super_admin to delete another owner’s agent', async () => {
    asUser('admin-1', 'super_admin');

    const res = await request(app)
      .delete('/api/v1/agents/a1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(deleteSpy).toHaveBeenCalledWith('a1');
  });

  it('returns 404 when a project_admin deletes another owner’s agent', async () => {
    asUser('other-1', 'project_admin');

    const res = await request(app)
      .delete('/api/v1/agents/a1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
