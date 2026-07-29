const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');

jest.mock('../db', () => {
  const mockPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool: mockPool };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

describe('CSP Violations API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/csp-report', () => {
    it('accepts CSP report without auth', async () => {
      const res = await request(app)
        .post('/api/csp-report')
        .send({
          'csp-report': {
            'document-uri': 'https://example.com',
            'referrer': 'https://example.com/',
            'blocked-uri': 'https://evil.com/test.js',
            'violated-directive': 'script-src',
            'original-policy': "default-src 'self'",
          },
        });

      expect(res.status).toBe(204);
      expect(pool.query).toHaveBeenCalledWith(
        'INSERT INTO csp_violations (violated_directive, blocked_uri, document_uri, referrer, original_policy) VALUES ($1, $2, $3, $4, $5)',
        ['script-src', 'https://evil.com/test.js', 'https://example.com', 'https://example.com/', "default-src 'self'"]
      );
    });

    it('handles empty report body', async () => {
      const res = await request(app)
        .post('/api/csp-report')
        .send({});

      expect(res.status).toBe(204);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('handles missing csp-report key', async () => {
      const res = await request(app)
        .post('/api/csp-report')
        .send({ other: 'data' });

      expect(res.status).toBe(204);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/csp-violations', () => {
    it('returns paginated violations', async () => {
      jest.mocked(pool.query).mockImplementation((sql) => {
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '5' }] });
        }
        return Promise.resolve({
          rows: [
            { id: 1, violated_directive: 'script-src', blocked_uri: 'https://evil.com/a.js', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T12:00:00.000Z' },
            { id: 2, violated_directive: 'style-src', blocked_uri: 'https://evil.com/b.css', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T11:00:00.000Z' },
          ],
        });
      });

      const res = await request(app)
        .get('/api/v1/csp-violations')
        .set('Authorization', 'Bearer mock-token')
        .query({ limit: 2, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.violations).toHaveLength(2);
      expect(res.body.data.total).toBe(5);
      expect(res.body.data.limit).toBe(2);
      expect(res.body.data.offset).toBe(0);
    });

    it('filters by directive', async () => {
      jest.mocked(pool.query).mockImplementation((sql) => {
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '2' }] });
        }
        return Promise.resolve({
          rows: [
            { id: 1, violated_directive: 'script-src', blocked_uri: 'https://evil.com/a.js', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T12:00:00.000Z' },
            { id: 2, violated_directive: 'script-src', blocked_uri: 'https://evil.com/b.js', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T11:00:00.000Z' },
          ],
        });
      });

      const res = await request(app)
        .get('/api/v1/csp-violations')
        .set('Authorization', 'Bearer mock-token')
        .query({ directive: 'script-src' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(2);
      for (const v of res.body.data.violations) {
        expect(v.violated_directive).toBe('script-src');
      }
    });

    it('returns violations ordered by created_at DESC', async () => {
      jest.mocked(pool.query).mockImplementation((sql) => {
        if (sql.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ count: '3' }] });
        }
        return Promise.resolve({
          rows: [
            { id: 1, violated_directive: 'script-src', blocked_uri: 'https://evil.com/a.js', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T12:00:00.000Z' },
            { id: 2, violated_directive: 'style-src', blocked_uri: 'https://evil.com/b.css', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T11:00:00.000Z' },
            { id: 3, violated_directive: 'img-src', blocked_uri: 'https://evil.com/c.png', document_uri: 'https://example.com/', referrer: '', created_at: '2025-07-12T10:00:00.000Z' },
          ],
        });
      });

      const res = await request(app)
        .get('/api/v1/csp-violations')
        .set('Authorization', 'Bearer mock-token')
        .query({ limit: 10 });

      expect(res.status).toBe(200);
      const violations = res.body.data.violations;
      for (let i = 0; i < violations.length - 1; i++) {
        expect(new Date(violations[i].created_at) >= new Date(violations[i + 1].created_at)).toBe(true);
      }
    });
  });

  describe('DELETE /api/v1/csp-violations', () => {
    it('clears all violations', async () => {
      jest.mocked(pool.query).mockImplementation((sql) => {
        if (sql.includes('DELETE')) {
          return Promise.resolve({ rowCount: 5 });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .delete('/api/v1/csp-violations')
        .set('Authorization', 'Bearer mock-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deletedCount).toBe(5);
    });

    it('returns 0 when no violations exist', async () => {
      jest.mocked(pool.query).mockImplementation((sql) => {
        if (sql.includes('DELETE')) {
          return Promise.resolve({ rowCount: 0 });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .delete('/api/v1/csp-violations')
        .set('Authorization', 'Bearer mock-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deletedCount).toBe(0);
    });
  });
});
