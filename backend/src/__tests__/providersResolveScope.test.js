const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const { pool } = require('../db');
const ProviderService = require('../services/ProviderService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(() => 'mock-token'),
}));

jest.mock('../services/ProviderService', () => ({
  resolveProvider: jest.fn(),
  invalidateProviderCache: jest.fn(),
}));

describe('POST /api/v1/providers/resolve authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    ProviderService.resolveProvider.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      api_key: 'sk-test',
    });
    jwt.verify.mockReturnValue({ userId: '7', role: 'member' });
  });

  it('denies a caller who does not own or belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ project_id: 99 });

    expect(res.statusCode).toBe(403);
    expect(ProviderService.resolveProvider).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM projects p'),
      [99, '7', 'member']
    );
  });

  it('denies a plain project member', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ project_id: 5, role: 'worker' });

    expect(res.statusCode).toBe(403);
    expect(ProviderService.resolveProvider).not.toHaveBeenCalled();
    expect(pool.query.mock.calls[0][0]).toContain("$3 IN ('project_admin','super_admin')");
    expect(pool.query.mock.calls[0][1]).toEqual([5, '7', 'member']);
  });

  it('allows a project_admin member', async () => {
    jwt.verify.mockReturnValueOnce({ userId: '7', role: 'project_admin' });
    pool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ project_id: 5, role: 'worker' });

    expect(res.statusCode).toBe(200);
    expect(ProviderService.resolveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'worker' }),
      5,
      '7'
    );
  });

  it('allows the project owner regardless of global role', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ project_id: 5 });

    expect(res.statusCode).toBe(200);
    expect(ProviderService.resolveProvider).toHaveBeenCalled();
  });

  it('lets super_admin resolve any project without a membership query', async () => {
    jwt.verify.mockReturnValueOnce({ userId: '1', role: 'super_admin' });

    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ project_id: 99 });

    expect(res.statusCode).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
    expect(ProviderService.resolveProvider).toHaveBeenCalledWith(
      expect.anything(), 99, '1'
    );
  });

  it('rejects a malformed project_id before querying', async () => {
    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ project_id: 'not-a-number' });

    expect(res.statusCode).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
    expect(ProviderService.resolveProvider).not.toHaveBeenCalled();
  });

  it('resolves owner-global credentials without a project', async () => {
    const res = await request(app)
      .post('/api/v1/providers/resolve')
      .set('Authorization', 'Bearer token')
      .send({ phase: 'review' });

    expect(res.statusCode).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
    expect(ProviderService.resolveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'review' }),
      null,
      '7'
    );
  });
});
