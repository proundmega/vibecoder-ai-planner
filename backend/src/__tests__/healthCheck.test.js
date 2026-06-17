const request = require('supertest');
const app = require('../index');

describe('BP-08: Docker Health Check', () => {
  describe('GET /api/health', () => {
    it('should return 200 with success structure', async () => {
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
    });

    it('should return status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.data.status).toBe('ok');
    });

    it('should return timestamp', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.data.timestamp).toBeDefined();
      expect(new Date(res.body.data.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should return database status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.data).toHaveProperty('database');
    });
  });
});
