const app = require('../index');
const request = require('supertest');

describe('CSP Header', () => {
  it('should set CSP header on responses', async () => {
    const res = await request(app).get('/api/health');
    
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('should have default-src self in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
  });

  it('should have script-src self unsafe-inline in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src");
    expect(csp).toContain("'unsafe-inline'");
  });

  it('should have style-src self unsafe-inline in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("style-src");
    expect(csp).toContain("'unsafe-inline'");
  });

  it('should have frame-ancestors none in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should have object-src none in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("object-src 'none'");
  });

  it('should not have unsafe-eval in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    expect(csp).not.toContain('unsafe-eval');
  });

  it('should not have wildcard in CSP', async () => {
    const res = await request(app).get('/api/health');
    
    const csp = res.headers['content-security-policy'];
    // Check that * is not used in any directive (except as part of 'self' or other values)
    const directives = csp.split(';');
    directives.forEach(directive => {
      const parts = directive.trim().split(' ');
      if (parts.length > 1) {
        const sources = parts.slice(1);
        sources.forEach(source => {
          expect(source).not.toBe('*');
        });
      }
    });
  });
});

describe('CSP Report Endpoint', () => {
  it('should accept CSP violation reports', async () => {
    const report = {
      'csp-report': {
        'document-uri': 'http://example.com',
        'blocked-uri': 'http://malicious.com/script.js',
        'violated-directive': 'script-src',
      },
    };
    
    const res = await request(app).post('/api/csp-report').send(report);
    
    expect(res.status).toBe(204);
  });

  it('should return 404 for unversioned CSP report', async () => {
    const report = {
      'csp-report': {
        'document-uri': 'http://example.com',
      },
    };
    
    const res = await request(app).post('/csp-report').send(report);
    
    // Should be caught by the catch-all middleware
    expect(res.status).toBe(404);
  });
});
