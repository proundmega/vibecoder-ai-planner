const { Pool } = require('pg');
const app = require('../../index');
const request = require('supertest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Ticket dependency gates (real DB)', () => {
  let token;
  let projectId;
  const createdTickets = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }

    const email = `bp134_${Date.now()}@test.com`;
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'BP134 Admin', email, password: 'password123', role: 'project_admin' });

    token = registerRes.body.token;

    const projectRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dependency Gates Project' });

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
      await pool.query("DELETE FROM users WHERE email LIKE 'bp134_%@test.com'");
    } catch (e) {
      console.error('Cleanup users failed:', e.message);
    }
    await pool.end();
  });

  async function createTicket(title, dependsOn = []) {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, title });

    expect(res.status).toBe(201);
    const id = res.body.data.id;
    createdTickets.push(id);

    if (dependsOn.length > 0) {
      const update = await request(app)
        .put(`/api/v1/tickets/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dependsOn });
      expect(update.status).toBe(200);
    }

    return id;
  }

  test('blocks pickup/status until dependencies are done and exposes readiness', async () => {
    const dependencyId = await createTicket('Dependency');
    const dependentId = await createTicket('Dependent', [dependencyId]);

    const blocked = await request(app)
      .get(`/api/v1/tickets/${dependentId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(blocked.status).toBe(200);
    expect(blocked.body.data.ready).toBe(false);
    expect(blocked.body.data.blockedBy).toEqual([
      expect.objectContaining({
        id: String(dependencyId),
        title: 'Dependency',
        status: 'backlog',
        reason: 'not_done',
      }),
    ]);

    const start = await request(app)
      .post(`/api/v1/tickets/${dependentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });

    expect(start.status).toBe(409);
    expect(start.body.error.code).toBe('DEPENDENCIES_NOT_DONE');
    expect(start.body.error.details.blockedBy[0].id).toBe(String(dependencyId));

    await pool.query(
      "UPDATE tickets SET status = 'done', phase = 'done' WHERE id = $1",
      [dependencyId]
    );

    const ready = await request(app)
      .get(`/api/v1/tickets/${dependentId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(ready.body.data.ready).toBe(true);
    expect(ready.body.data.blockedBy).toEqual([]);

    const allowed = await request(app)
      .post(`/api/v1/tickets/${dependentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });

    expect(allowed.status).toBe(200);
  });

  test('excludes blocked tickets from the agent backlog endpoint', async () => {
    const doneId = await createTicket('Done dependency');
    await pool.query(
      "UPDATE tickets SET status = 'done', phase = 'done' WHERE id = $1",
      [doneId]
    );

    const readyId = await createTicket('Ready backlog', [doneId]);
    const blockedId = await createTicket('Blocked backlog', [readyId]);

    const res = await request(app)
      .get(`/api/v1/tickets/project/${projectId}/backlog`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map(ticket => String(ticket.id));
    expect(ids).toContain(String(readyId));
    expect(ids).not.toContain(String(blockedId));
  });

  test('fails closed for missing and cross-project dependencies', async () => {
    const missingId = await createTicket('Missing dependency', ['999999999']);
    const missing = await request(app)
      .get(`/api/v1/tickets/${missingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(missing.body.data.ready).toBe(false);
    expect(missing.body.data.blockedBy[0].reason).toBe('missing');
    expect(missing.body.data.blockedBy[0].title).toBeNull();

    const otherProject = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Other Dependency Project' });
    const otherTicket = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId: otherProject.body.data.id, title: 'Other project ticket' });

    const crossId = await createTicket('Cross dependency', [otherTicket.body.data.id]);
    const cross = await request(app)
      .get(`/api/v1/tickets/${crossId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(cross.body.data.ready).toBe(false);
    expect(cross.body.data.blockedBy[0].reason).toBe('cross_project');
    expect(cross.body.data.blockedBy[0].title).toBeNull();

    await pool.query('DELETE FROM tickets WHERE project_id = $1', [otherProject.body.data.id]);
    await pool.query('DELETE FROM projects WHERE id = $1', [otherProject.body.data.id]);
  });
});
