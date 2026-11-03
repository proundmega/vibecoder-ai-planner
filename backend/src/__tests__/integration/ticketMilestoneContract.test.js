const { Pool } = require('pg');
const app = require('../../index');
const request = require('supertest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Ticket milestone contract (real DB)', () => {
  let token;
  let projectId;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }

    const email = `bp124_${Date.now()}@test.com`;
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'BP124 Admin', email, password: 'password123', role: 'project_admin' });

    token = registerRes.body.token;

    const projectRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Milestone Contract Project' });

    projectId = projectRes.body.data.id;
  });

  afterAll(async () => {
    try {
      await pool.query('DELETE FROM tickets WHERE project_id = $1', [projectId]);
    } catch (e) {
      console.error('Cleanup tickets failed:', e.message);
    }
    try {
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    } catch (e) {
      console.error('Cleanup projects failed:', e.message);
    }
    try {
      await pool.query("DELETE FROM users WHERE email LIKE 'bp124_%@test.com'");
    } catch (e) {
      console.error('Cleanup users failed:', e.message);
    }
    await pool.end();
  });

  async function createTicket(title) {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, title });

    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  test('PUT persists dependsOn/estimate and returns dependsOn as string[]', async () => {
    const dependencyId = await createTicket('Dependency');
    const ticketId = await createTicket('Dependent');

    const updateRes = await request(app)
      .put(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ milestoneId: null, estimate: 3, dependsOn: [dependencyId] });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.estimate).toBe(3);
    expect(updateRes.body.data.dependsOn).toEqual([String(dependencyId)]);
    expect(typeof updateRes.body.data.dependsOn[0]).toBe('string');

    const getRes = await request(app)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.dependsOn).toEqual([String(dependencyId)]);
    expect(typeof getRes.body.data.dependsOn[0]).toBe('string');
    // BIGSERIAL ids come back from pg as decimal strings, not numbers.
    expect(typeof getRes.body.data.id).toBe('string');
  });
});
