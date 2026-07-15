const cors = require('../middleware/cors');
const request = require('supertest');

describe('CORS Middleware', () => {
  let app;

  beforeEach(() => {
    app = require('express')();
    app.use(cors(['http://localhost:3000', 'https://app.vibecode.ai']));
    app.get('/test', (req, res) => {
      res.json({ success: true, data: { message: 'ok' } });
    });
    app.post('/test', (req, res) => {
      res.json({ success: true, data: { message: 'created' } });
    });
    app.delete('/test', (req, res) => {
      res.status(204).send();
    });
  });

  it('should allow requests from allowed origins', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://localhost:3000');
    
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('should allow requests from multiple allowed origins', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.vibecode.ai');
    
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.vibecode.ai');
  });

  it('should block requests from disallowed origins', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://evil.com');
    
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CORS_ERROR');
    expect(res.body.error.message).toBe('Origin not allowed');
  });

  it('should allow requests without Origin header', async () => {
    const res = await request(app)
      .get('/test');
    
    expect(res.status).toBe(200);
  });

  it('should return CORS headers on error responses', async () => {
    app.get('/error', (req, res) => {
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
    });
    
    const res = await request(app)
      .get('/error')
      .set('Origin', 'http://localhost:3000');
    
    expect(res.status).toBe(500);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('should handle OPTIONS preflight with 204', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'http://localhost:3000');
    
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('should include all required CORS headers on preflight', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'http://localhost:3000');
    
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type, Authorization, X-API-Key');
    expect(res.headers['access-control-max-age']).toBe('86400');
  });

  it('should block OPTIONS preflight from disallowed origins', async () => {
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://unauthorized.com');
    
    expect(res.status).toBe(403);
  });

  it('should support different HTTP methods', async () => {
    const resGet = await request(app).get('/test').set('Origin', 'http://localhost:3000');
    expect(resGet.status).toBe(200);
    
    const resPost = await request(app).post('/test').set('Origin', 'http://localhost:3000');
    expect(resPost.status).toBe(200);
    
    const resDelete = await request(app).delete('/test').set('Origin', 'http://localhost:3000');
    expect(resDelete.status).toBe(204);
  });
});

describe('CORS with empty origins', () => {
  let app;

  beforeEach(() => {
    app = require('express')();
    app.use(cors([]));
    app.get('/test', (req, res) => {
      res.json({ success: true, data: { message: 'ok' } });
    });
  });

  it('should block all requests with origins when no origins are allowed', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://localhost:3000');
    
    expect(res.status).toBe(403);
  });

  it('should allow requests without Origin header', async () => {
    const res = await request(app)
      .get('/test');
    
    expect(res.status).toBe(200);
  });
});
