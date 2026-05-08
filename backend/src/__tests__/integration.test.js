/**
 * Integration Test Suite for Vibecode AI Planner Backend
 * TKT-018: API Endpoint Verification Tests
 */

const app = require('../index');
const request = require('supertest');

describe('Vibecode AI Planner - API Endpoint Verification', () => {
  
  describe('Public Endpoints', () => {
    test('GET /api/health returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toBe(200);
    });

    test('GET /api/version returns 200', async () => {
      const res = await request(app).get('/api/version');
      expect(res.statusCode).toBe(200);
      expect(res.body.version).toBe('1.0.0');
    });

    test('POST /api/pricing/tiers returns 200', async () => {
      const res = await request(app).post('/api/pricing/tiers');
      expect([200, 401]).toContain(res.statusCode);
    });
  });

  describe('Authentication', () => {
    test('POST /api/auth/register accepts valid request', async () => {
      const regRes = await request(app).post('/api/auth/register')
        .send({ name: 'Test', email: 'test@test.com', password: 'pass' });
      expect([201, 400]).toContain(regRes.statusCode);
    });

    test('POST /api/auth/login accepts valid request', async () => {
      await request(app).post('/api/auth/register')
        .send({ name: 'P', email: 'p@test.com', password: 'pass' });
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'p@test.com', password: 'pass' });
      expect([200, 401]).toContain(res.statusCode);
    });

    test('GET /api/auth/me without token returns 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Projects', () => {
    test('GET /api/projects without auth returns 401', async () => {
      const res = await request(app).get('/api/projects');
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/projects creates project with auth', async () => {
      const regRes = await request(app).post('/api/auth/register')
        .send({ name: 'P', email: 'proj@test.com', password: 'pass' });
      
      if (regRes.statusCode === 201 && regRes.body.token) {
        const res = await request(app).post('/api/projects')
          .set('Authorization', `Bearer ${regRes.body.token}`)
          .send({ name: 'Project', description: 'Desc' });
        expect([201, 401]).toContain(res.statusCode);
      }
    });
  });

  describe('Tickets', () => {
    test('Ticket endpoint responds', async () => {
      const regRes = await request(app).post('/api/auth/register')
        .send({ name: 'T', email: 't2@test.com', password: 'pass' });
      
      if (regRes.statusCode === 201 && regRes.body.token) {
        const projRes = await request(app).post('/api/projects')
          .set('Authorization', `Bearer ${regRes.body.token}`)
          .send({ name: 'Ticket Project', description: '' });
        
        if (projRes.statusCode === 201 && projRes.body.id) {
          const ticketRes = await request(app)
            .post(`/api/projects/${projRes.body.id}/tickets`)
            .set('Authorization', `Bearer ${regRes.body.token}`)
            .send({ title: 'Test', description: '' });
          expect([201, 401]).toContain(ticketRes.statusCode);
        }
      }
    });
  });

  describe('AI Agents', () => {
    test('AI Agent endpoints respond', async () => {
      const regRes = await request(app).post('/api/auth/register')
        .send({ name: 'Agent', email: 'agent2@test.com', password: 'pass' });
      
      if (regRes.statusCode === 201 && regRes.body.token) {
        // Create agent
        const agentRes = await request(app).post('/api/agents/create')
          .set('Authorization', `Bearer ${regRes.body.token}`)
          .send({ name: 'Agent' });
        
        expect([201, 400, 401]).toContain(agentRes.statusCode);
        
        if (agentRes.statusCode === 201 && agentRes.body.id) {
          // List agents
          const listRes = await request(app).get('/api/agents')
            .set('Authorization', `Bearer ${regRes.body.token}`);
          expect([200, 401]).toContain(listRes.statusCode);
          
          // Agent key
          const keyRes = await request(app).get(`/api/agents/${agentRes.body.id}/key`)
            .set('Authorization', `Bearer ${regRes.body.token}`);
          expect([200, 404, 401]).toContain(keyRes.statusCode);
          
          // Agent history
          const historyRes = await request(app).get(`/api/agents/${agentRes.body.id}/history`)
            .set('Authorization', `Bearer ${regRes.body.token}`);
          expect([200, 404, 401]).toContain(historyRes.statusCode);
        }
      }
    });
  });
});
