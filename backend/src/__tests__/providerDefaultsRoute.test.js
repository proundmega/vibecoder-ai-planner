const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: 'user-1', email: 'user@test.com', role: 'member' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  maskToken: jest.fn(),
}));

describe('GET /api/v1/providers/defaults', () => {
  it('returns the provider catalog instead of treating "defaults" as an id', async () => {
    const res = await request(app)
      .get('/api/v1/providers/defaults')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'opencode',
        endpointUrl: 'https://opencode.ai/zen/v1',
        requiresModel: true,
      }),
      expect.objectContaining({
        type: 'opencode-go',
        endpointUrl: 'https://opencode.ai/zen/go/v1',
        requiresModel: true,
      }),
    ]));
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/providers/defaults');

    expect(res.statusCode).toBe(401);
  });
});
