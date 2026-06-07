const { Pool } = require('pg');
const app = require('../../index');
const request = require('supertest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Vibecode Integration (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
  });

  async function cleanTable(table) {
    await pool.query(`DELETE FROM ${table} CASCADE`);
  }

  afterEach(async () => {
    try {
      await cleanTable('tickets');
    } catch (e) {
      console.error('Cleanup tickets failed:', e.message);
    }
    try {
      await cleanTable('projects');
    } catch (e) {
      console.error('Cleanup projects failed:', e.message);
    }
    try {
      await cleanTable('users');
    } catch (e) {
      console.error('Cleanup users failed:', e.message);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Auth', () => {
    test('POST /api/auth/register creates user', async () => {
      const email = `reg_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Test User', email, password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(email);
    });

    test('POST /api/auth/register fails with duplicate email', async () => {
      const email = `dup_${Date.now()}@test.com`;
      await request(app).post('/api/auth/register').send({
        name: 'First', email, password: 'password123',
      });

      const res = await request(app).post('/api/auth/register').send({
        name: 'Second', email, password: 'password123',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('POST /api/auth/login returns token for valid credentials', async () => {
      const email = `login_${Date.now()}@test.com`;
      await request(app).post('/api/auth/register').send({
        name: 'Login Test', email, password: 'correctpassword',
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'correctpassword' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    test('POST /api/auth/login fails with wrong password', async () => {
      const email = `wrong_${Date.now()}@test.com`;
      await request(app).post('/api/auth/register').send({
        name: 'Wrong PW', email, password: 'correctpassword',
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    test('GET /api/auth/me returns user for authenticated request', async () => {
      const email = `me_${Date.now()}@test.com`;
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Me Test', email, password: 'password123',
      });
      const token = regRes.body.token;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
    });

    test('GET /api/auth/me returns 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    test('GET /api/auth/me returns 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });
  });

  describe('Projects', () => {
    let token;

    beforeEach(async () => {
      const email = `proj_${Date.now()}@test.com`;
      const res = await request(app).post('/api/auth/register').send({
        name: 'Proj Owner', email, password: 'password123', role: 'project_admin',
      });
      token = res.body.token;
    });

    test('POST /api/projects returns 403 for user role without PROJECT_CREATE', async () => {
      const userEmail = `user_${Date.now()}@test.com`;
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'User', email: userEmail, password: 'password123',
      });
      const userToken = regRes.body.token;

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'No Permission Project' });

      expect(res.status).toBe(403);
    });

    test('POST /api/projects creates project', async () => {
      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'My Project', description: 'A test project' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('My Project');
    });

    test('POST /api/projects returns 403 for user role without PROJECT_CREATE', async () => {
      const userEmail = `user_${Date.now()}@test.com`;
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'User', email: userEmail, password: 'password123',
      });
      const userToken = regRes.body.token;

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'No Permission Project' });

      expect(res.status).toBe(403);
    });

    test('GET /api/projects lists user projects', async () => {
      await request(app).post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Project One' });

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('GET /api/projects/:id returns project', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Single Project' });

      const res = await request(app)
        .get(`/api/projects/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Single Project');
    });

    test('GET /api/projects/:id returns 404 for unknown id', async () => {
      const res = await request(app)
        .get('/api/projects/999999999')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    test('DELETE /api/projects/:id removes project', async () => {
      const createRes = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'To Delete' });

      const res = await request(app)
        .delete(`/api/projects/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    test('POST /api/projects fails without auth', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'No Auth Project' });
      expect(res.status).toBe(401);
    });
  });

  describe('Tickets', () => {
    let token;
    let projectId;

    beforeEach(async () => {
      const email = `ticket_${Date.now()}@test.com`;
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Ticket Owner', email, password: 'password123', role: 'project_admin',
      });
      token = regRes.body.token;

      const projRes = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ticket Test Project' });
      projectId = projRes.body.data.id;
    });

    test('POST /api/projects/:id/tickets creates ticket', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Bug Fix', description: 'Fix the bug', priority: 'high' });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('Bug Fix');
      expect(res.body.data.priority).toBe('high');
    });

    test('PATCH /api/tickets/:id/status transitions to in_progress', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Status Test Ticket' });

      const res = await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in_progress');
    });

    test('PATCH /api/tickets/:id/status transitions to review', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Review Ticket' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress' });

      const res = await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'review' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('review');
    });

    test('PATCH /api/tickets/:id/status rejects done from in_progress', async () => {
      const ticketRes = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Invalid Transition' });

      await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress' });

      const res = await request(app)
        .post(`/api/projects/${projectId}/tickets/${ticketRes.body.data.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done' });

      expect(res.status).toBe(400);
    });

    test('GET /api/projects/:id/tickets lists tickets', async () => {
      await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Ticket A' });
      await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Ticket B' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/tickets`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    test('POST /api/projects/:id/tickets fails without auth', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'No Auth Ticket' });
      expect(res.status).toBe(401);
    });
  });

  describe('Health', () => {
    test('GET /api/health returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    });

    test('GET /api/version returns version', async () => {
      const res = await request(app).get('/api/version');
      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe('1.0.0');
    });
  });
});