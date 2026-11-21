const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    verifyTokenOrAgent: (req, res, next) => {
      if (req.headers.authorization) {
        return actual.verifyToken(req, res, next);
      }
      if (!req.headers['x-api-key']) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing authentication token' },
        });
      }
      req.agent = {
        id: 3, owner_id: 7, project_id: 1, _node: true, _nodeRecord: { id: 12 },
      };
      req.node = { id: 12 };
      req.runtime = {
        id: 3, role: 'worker', status: 'running', current_project_id: 1,
      };
      req.user = { userId: 'user-1', id: 3, role: 'member' };
      return next();
    },
  };
});

jest.mock('../middleware/agentRole', () => {
  const actual = jest.requireActual('../middleware/agentRole');
  const pass = () => (req, res, next) => next();
  return {
    ...actual,
    requireRuntime: pass,
    requireRole: pass,
    requireBodyGrant: pass,
    requireRunGrant: pass,
    requireTicketGrant: pass,
    requireProjectGrant: pass,
  };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    userId: 'user-1', id: 'user-1', email: 'user@test.com', role: 'project_admin',
  }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/RepoProfileService', () => ({
  getCurrent: jest.fn(),
  listVersions: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  activate: jest.fn(),
  detect: jest.fn(),
  getActiveForAgent: jest.fn(),
  createMtlsCredential: jest.fn(),
  listMtlsCredentials: jest.fn(),
  deleteMtlsCredential: jest.fn(),
  getMtlsMaterialForAgent: jest.fn(),
}));

jest.mock('../services/RepoProfileValidationService', () => ({
  request: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
  claimNext: jest.fn(),
  finish: jest.fn(),
}));

const RepoProfileService = require('../services/RepoProfileService');
const RepoProfileValidationService = require('../services/RepoProfileValidationService');
const jwt = require('jsonwebtoken');

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const VALIDATION_ID = '22222222-2222-4222-8222-222222222222';

const PROFILE = {
  id: PROFILE_ID,
  project_id: 1,
  version: 1,
  status: 'draft',
  profile: { schema_version: 1, verify: ['npm test'] },
};

describe('Repo profile API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({
      userId: 'user-1', id: 'user-1', email: 'user@test.com', role: 'project_admin',
    });
  });

  it('returns the active profile and versions', async () => {
    RepoProfileService.getCurrent.mockResolvedValue({
      active: PROFILE, latest: PROFILE, versions: [PROFILE],
    });

    const res = await request(app)
      .get('/api/v1/projects/1/repo-profile')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.active.id).toBe(PROFILE_ID);
    expect(RepoProfileService.getCurrent).toHaveBeenCalledWith('1', expect.objectContaining({
      userId: 'user-1',
    }));
  });

  it('creates a draft profile', async () => {
    RepoProfileService.create.mockResolvedValue(PROFILE);

    const res = await request(app)
      .post('/api/v1/projects/1/repo-profile')
      .set('Authorization', 'Bearer mock-token')
      .send({ verify: ['npm test'] });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBe(PROFILE_ID);
    expect(RepoProfileService.create).toHaveBeenCalledWith('1', { verify: ['npm test'] },
      expect.objectContaining({ userId: 'user-1' }));
  });

  it('edits and activates a draft', async () => {
    RepoProfileService.update.mockResolvedValue(PROFILE);
    RepoProfileService.activate.mockResolvedValue({ ...PROFILE, status: 'active' });

    const put = await request(app)
      .put(`/api/v1/projects/1/repo-profile/${PROFILE_ID}`)
      .set('Authorization', 'Bearer mock-token')
      .send({ verify: ['npm test'] });
    expect(put.statusCode).toBe(200);

    const activate = await request(app)
      .post(`/api/v1/projects/1/repo-profile/${PROFILE_ID}/activate`)
      .set('Authorization', 'Bearer mock-token');
    expect(activate.statusCode).toBe(200);
    expect(activate.body.data.status).toBe('active');
  });

  it('detects a proposed profile', async () => {
    RepoProfileService.detect.mockResolvedValue({
      detected: true,
      profile: { verify: ['npm test'] },
      warnings: [],
    });

    const res = await request(app)
      .post('/api/v1/projects/1/repo-profile/detect')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.detected).toBe(true);
  });

  it('queues and reads dry-run validations', async () => {
    RepoProfileValidationService.request.mockResolvedValue({
      id: VALIDATION_ID, status: 'queued',
    });
    RepoProfileValidationService.list.mockResolvedValue([{ id: VALIDATION_ID }]);
    RepoProfileValidationService.get.mockResolvedValue({ id: VALIDATION_ID, status: 'succeeded' });

    const queued = await request(app)
      .post(`/api/v1/projects/1/repo-profile/${PROFILE_ID}/validate`)
      .set('Authorization', 'Bearer mock-token');
    expect(queued.statusCode).toBe(201);

    const list = await request(app)
      .get('/api/v1/projects/1/repo-profile/validations')
      .set('Authorization', 'Bearer mock-token');
    expect(list.statusCode).toBe(200);

    const one = await request(app)
      .get(`/api/v1/projects/1/repo-profile/validations/${VALIDATION_ID}`)
      .set('Authorization', 'Bearer mock-token');
    expect(one.statusCode).toBe(200);
  });

  it('serves the active profile to an agent', async () => {
    RepoProfileService.getActiveForAgent.mockResolvedValue(PROFILE);

    const res = await request(app)
      .get('/api/v1/projects/1/repo-profile/agent')
      .set('X-API-Key', 'agent-key');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(PROFILE_ID);
    expect(RepoProfileService.getActiveForAgent).toHaveBeenCalledWith(
      '1', expect.objectContaining({ id: 3, owner_id: 7 })
    );
  });

  it('claims and finishes a dry run for an agent', async () => {
    RepoProfileValidationService.claimNext.mockResolvedValue({
      id: VALIDATION_ID, status: 'running',
    });
    RepoProfileValidationService.finish.mockResolvedValue({
      id: VALIDATION_ID, status: 'succeeded',
    });

    const claim = await request(app)
      .post('/api/v1/projects/1/repo-profile/validations/claim')
      .set('X-API-Key', 'agent-key');
    expect(claim.statusCode).toBe(200);
    expect(claim.body.data.status).toBe('running');

    const finish = await request(app)
      .post(`/api/v1/projects/1/repo-profile/validations/${VALIDATION_ID}/finish`)
      .set('X-API-Key', 'agent-key')
      .send({ status: 'succeeded', result: { ok: true } });
    expect(finish.statusCode).toBe(200);
    expect(RepoProfileValidationService.finish).toHaveBeenCalledWith(
      '1', VALIDATION_ID, expect.objectContaining({ id: 3 }),
      { status: 'succeeded', result: { ok: true } }, 3
    );
  });


  it('stores, lists and deactivates repo-profile mTLS credentials', async () => {
    RepoProfileService.createMtlsCredential.mockResolvedValue({
      id: 5, name: 'registry-client', hosts: ['registry.example.com'],
    });
    RepoProfileService.listMtlsCredentials.mockResolvedValue([{ id: 5 }]);
    RepoProfileService.deleteMtlsCredential.mockResolvedValue({ id: 5, is_active: false });

    const created = await request(app)
      .post('/api/v1/projects/1/repo-profile/credentials/mtls')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: 'registry-client', hosts: ['registry.example.com'] });
    expect(created.statusCode).toBe(201);
    expect(RepoProfileService.createMtlsCredential).toHaveBeenCalledWith(
      '1', expect.objectContaining({ name: 'registry-client' }),
      expect.objectContaining({ userId: 'user-1' })
    );

    const listed = await request(app)
      .get('/api/v1/projects/1/repo-profile/credentials/mtls')
      .set('Authorization', 'Bearer mock-token');
    expect(listed.statusCode).toBe(200);

    const deleted = await request(app)
      .delete('/api/v1/projects/1/repo-profile/credentials/mtls/5')
      .set('Authorization', 'Bearer mock-token');
    expect(deleted.statusCode).toBe(200);
    expect(RepoProfileService.deleteMtlsCredential).toHaveBeenCalledWith(
      '1', '5', expect.objectContaining({ userId: 'user-1' }));
  });

  it('serves mTLS material only to an agent key', async () => {
    RepoProfileService.getMtlsMaterialForAgent.mockResolvedValue({
      hosts: ['registry.example.com'],
      cert_b64: 'Y2VydA==',
      key_b64: 'a2V5',
      cert_sha256: 'abc',
    });

    const missing = await request(app)
      .get('/api/v1/projects/1/repo-profile/agent/mtls')
      .set('X-API-Key', 'agent-key');
    expect(missing.statusCode).toBe(400);

    const res = await request(app)
      .get('/api/v1/projects/1/repo-profile/agent/mtls')
      .query({ profileId: '11111111-1111-4111-8111-111111111111', profileVersion: 3 })
      .set('X-API-Key', 'agent-key');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.hosts).toEqual(['registry.example.com']);
    expect(RepoProfileService.getMtlsMaterialForAgent).toHaveBeenCalledWith(
      '1', expect.objectContaining({ id: 3, owner_id: 7 }),
      '11111111-1111-4111-8111-111111111111', 3);

    const jwtOnly = await request(app)
      .get('/api/v1/projects/1/repo-profile/agent/mtls')
      .query({ profileId: '11111111-1111-4111-8111-111111111111', profileVersion: 3 })
      .set('Authorization', 'Bearer mock-token');
    expect(jwtOnly.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/projects/1/repo-profile');
    expect(res.statusCode).toBe(401);
  });

  it('requires an agent key for the agent routes', async () => {
    const res = await request(app)
      .get('/api/v1/projects/1/repo-profile/agent')
      .set('Authorization', 'Bearer mock-token');
    expect(res.statusCode).toBe(403);
  });
});
