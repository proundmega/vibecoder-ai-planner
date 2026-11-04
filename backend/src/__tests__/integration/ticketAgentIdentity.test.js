const { Pool } = require('pg');
const TicketService = require('../../services/TicketService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Ticket assigned agent identity (real DB)', () => {
  let userId;
  let projectId;
  let agentId;
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
    await pool.query('DELETE FROM tickets WHERE id = $1', [ticketId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM agents WHERE id = $1', [agentId]);
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
       WHERE tc.table_name = 'tickets'
         AND tc.constraint_name = 'tickets_assigned_agent_id_agent_fkey'`
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].ref_table).toBe('agents');
  });

  test('pickUpTicket stores the agent id and release clears it', async () => {
    const pickedUp = await TicketService.pickUpTicket(ticketId, agentId);

    expect(String(pickedUp.assigned_agent_id)).toBe(String(agentId));
    expect(pickedUp.status).toBe('in_progress');

    const released = await TicketService.releaseTicket(ticketId, agentId);

    expect(released.assigned_agent_id).toBeNull();
    expect(released.status).toBe('backlog');
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
