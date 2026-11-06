const { Pool } = require('pg');
const request = require('supertest');
const app = require('../../index');
const TicketService = require('../../services/TicketService');
const { ForbiddenError } = require('../../errors/HttpError');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Ticket assigned agent identity (real DB)', () => {
  let userId;
  let projectId;
  let agentId;
  let otherAgentId;
  let ticketId;

  beforeAll(async () => {
    const user = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Agent Identity Owner', 'x', 'project_admin') RETURNING id`,
      [`agent_identity_${suffix}@test.com`]
    );
    userId = user.rows[0].id;

    const project = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`Agent Identity Project ${suffix}`, userId]
    );
    projectId = project.rows[0].id;

    const agent = await pool.query(
      `INSERT INTO agents (name, api_key, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`agent-identity-${suffix}`, `key_${suffix}`, userId]
    );
    agentId = agent.rows[0].id;

    const otherAgent = await pool.query(
      `INSERT INTO agents (name, api_key, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`agent-identity-other-${suffix}`, `other_key_${suffix}`, userId]
    );
    otherAgentId = otherAgent.rows[0].id;

    const ticket = await pool.query(
      `INSERT INTO tickets (project_id, title, status, owner_id)
       VALUES ($1, 'Agent identity ticket', 'backlog', $2) RETURNING id`,
      [projectId, userId]
    );
    ticketId = ticket.rows[0].id;
  });

  beforeEach(async () => {
    await pool.query(
      `UPDATE tickets
       SET status = 'backlog', assigned_agent_id = NULL, locked_at = NULL
       WHERE id = $1`,
      [ticketId]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM tickets WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM agents WHERE id = ANY($1)', [[agentId, otherAgentId]]);
    await pool.query("DELETE FROM users WHERE email LIKE 'release_user_%'");
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  });

  test('assigned_agent_id references agents(id), not users(id)', async () => {
    const result = await pool.query(
      `SELECT ccu.table_name AS ref_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = current_schema()
         AND tc.table_name = 'tickets'
         AND tc.constraint_name = 'tickets_assigned_agent_id_agent_fkey'`
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].ref_table).toBe('agents');
  });

  test('pickUpTicket stores the agent id and release clears it', async () => {
    const pickedUp = await TicketService.pickUpTicket(ticketId, agentId);

    expect(String(pickedUp.assigned_agent_id)).toBe(String(agentId));
    expect(pickedUp.status).toBe('in_progress');

    const released = await TicketService.releaseTicket(ticketId, { agentId });

    expect(released.assigned_agent_id).toBeNull();
    expect(released.status).toBe('backlog');
  });

  test('release rejects an agent that does not own the ticket', async () => {
    await TicketService.pickUpTicket(ticketId, agentId);

    await expect(
      TicketService.releaseTicket(ticketId, { agentId: otherAgentId })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('a user-role JWT cannot release an agent-assigned ticket via the API', async () => {
    await TicketService.pickUpTicket(ticketId, agentId);

    const email = `release_user_${suffix}@test.com`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Release User', email, password: 'password123', role: 'user' });

    expect(registered.status).toBe(201);

    const response = await request(app)
      .post(`/api/v1/tickets/${ticketId}/release`)
      .set('Authorization', `Bearer ${registered.body.token}`);

    expect(response.status).toBe(403);

    const stored = await pool.query(
      'SELECT status, assigned_agent_id FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(stored.rows[0].status).toBe('in_progress');
    expect(String(stored.rows[0].assigned_agent_id)).toBe(String(agentId));
  });

  test('deleting an assigned agent releases an in_progress ticket', async () => {
    const doomedAgent = await pool.query(
      `INSERT INTO agents (name, api_key, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`agent-doomed-${suffix}`, `doomed_key_${suffix}`, userId]
    );
    const doomedAgentId = doomedAgent.rows[0].id;

    const doomedTicket = await pool.query(
      `INSERT INTO tickets (project_id, title, status, owner_id, assigned_agent_id, locked_at)
       VALUES ($1, 'Doomed agent ticket', 'in_progress', $2, $3, NOW())
       RETURNING id`,
      [projectId, userId, doomedAgentId]
    );

    await pool.query('DELETE FROM agents WHERE id = $1', [doomedAgentId]);

    const released = await pool.query(
      'SELECT status, assigned_agent_id, locked_at FROM tickets WHERE id = $1',
      [doomedTicket.rows[0].id]
    );

    expect(released.rows[0].status).toBe('backlog');
    expect(released.rows[0].assigned_agent_id).toBeNull();
    expect(released.rows[0].locked_at).toBeNull();
  });

  test('rejects an assigned_agent_id that is not an agent', async () => {
    const notAnAgent = await pool.query('SELECT COALESCE(MAX(id), 0) + 1000 AS id FROM agents');

    await expect(
      pool.query(
        `INSERT INTO tickets (project_id, title, status, owner_id, assigned_agent_id)
         VALUES ($1, 'Bad agent id', 'in_progress', $2, $3)`,
        [projectId, userId, notAnAgent.rows[0].id]
      )
    ).rejects.toMatchObject({ code: '23503' });
  });
});
