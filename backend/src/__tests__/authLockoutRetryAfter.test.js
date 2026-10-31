const request = require('supertest');
const app = require('../index');
const { recordFailedAttempt, clearFailedAttempts } = require('../middleware/auth');

describe('POST /api/auth/login lockout response', () => {
  const candidateIps = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];

  afterEach(() => {
    candidateIps.forEach(ip => clearFailedAttempts(ip));
  });

  it('returns a numeric Retry-After header when the IP is locked out', async () => {
    for (const ip of candidateIps) {
      for (let i = 0; i < 10; i++) {
        await recordFailedAttempt(ip);
      }
    }

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'locked@example.com', password: 'secret123' });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });
});
