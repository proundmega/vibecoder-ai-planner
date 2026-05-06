const request = require('supertest');
const app = require('../index');
const authService = require('../auth');

describe('Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
  });

  it('should have token endpoint', async () => {
    const res = await request(app).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
  });
});
