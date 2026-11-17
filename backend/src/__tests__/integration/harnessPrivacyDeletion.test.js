const crypto = require('crypto');
const { Pool } = require('pg');
const HarnessPrivacyService = require('../../services/HarnessPrivacyService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Harness privacy deletion (real DB)', () => {
  let ownerId;
  let projectId;
  let agentId;
  let ticketId;
  let runId;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Privacy Owner', 'x', 'project_admin') RETURNING id`,
      [`privacy_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;
    const project = await pool.query(
      'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
      [`Privacy Project ${suffix}`, ownerId]
    );
    projectId = project.rows[0].id;
    const agent = await pool.query(
      `INSERT INTO agents (name, api_key, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`privacy-agent-${suffix}`, `privacy_key_${suffix}`, ownerId]
    );
    agentId = agent.rows[0].id;
    const ticket = await pool.query(
      `INSERT INTO tickets (project_id, title, status, owner_id, assigned_agent_id)
       VALUES ($1, 'Privacy ticket', 'in_progress', $2, $3) RETURNING id`,
      [projectId, ownerId, agentId]
    );
    ticketId = ticket.rows[0].id;
    const run = await pool.query(
      `INSERT INTO harness_runs (ticket_id, agent_id, project_id, branch, status)
       VALUES ($1, $2, $3, $4, 'running') RETURNING id`,
      [ticketId, agentId, projectId, `privacy/${suffix}`]
    );
    runId = run.rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL harness.allow_event_purge = 'on'");
        await client.query('DELETE FROM harness_events WHERE project_id = $1', [projectId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await pool.query('DELETE FROM harness_usage WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM usage_logs WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM harness_privacy_policies WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    }
    if (ownerId) {
      await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    }
    await pool.end();
  });

  test('dataClasses all removes every stored run table but keeps the audit tombstone', async () => {
    await pool.query(
      `INSERT INTO harness_checkpoints (run_id, step, payload)
       VALUES ($1, 'cloning', '{"workspacePath":"/tmp/x"}')`,
      [runId]
    );
    await pool.query(
      `INSERT INTO harness_events
         (event_id, trace_id, project_id, run_id, type, payload)
       VALUES ($1, $2, $3, $4, 'prompt.sent', '{"length":10}')`,
      [crypto.randomUUID(), crypto.randomUUID(), projectId, runId]
    );
    await pool.query(
      `INSERT INTO harness_usage (run_id, ticket_id, project_id, model, input_tokens)
       VALUES ($1, $2, $3, 'beam-free', 10)`,
      [runId, ticketId, projectId]
    );
    await pool.query(
      `INSERT INTO ticket_messages (ticket_id, user_id, message_type, content)
       VALUES ($1, $2, 'update', 'contact alice@example.com')`,
      [ticketId, ownerId]
    );
    await pool.query(
      `INSERT INTO usage_logs (project_id, user_id, provider_type, model, ticket_id)
       VALUES ($1, $2, 'generic', 'beam-free', $3)`,
      [projectId, ownerId, ticketId]
    );

    const result = await HarnessPrivacyService.deleteProjectData({
      projectId,
      dataClasses: ['all'],
      reason: 'subject request',
      actorId: ownerId,
    });

    expect(result).toEqual({
      events: 1,
      usage: 1,
      messages: 1,
      checkpoints: 1,
      runs: 1,
      usageLogs: 1,
    });

    const remaining = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM harness_events
          WHERE project_id = $1 AND type NOT LIKE 'audit.%') AS events,
         (SELECT COUNT(*) FROM harness_usage WHERE project_id = $1) AS usage,
         (SELECT COUNT(*) FROM harness_checkpoints hc
          JOIN harness_runs r ON r.id = hc.run_id
          WHERE r.project_id = $1) AS checkpoints,
         (SELECT COUNT(*) FROM harness_runs WHERE project_id = $1) AS runs,
         (SELECT COUNT(*) FROM ticket_messages tm
          JOIN tickets t ON t.id = tm.ticket_id
          WHERE t.project_id = $1) AS messages,
         (SELECT COUNT(*) FROM usage_logs WHERE project_id = $1) AS usage_logs`,
      [projectId]
    );
    expect(remaining.rows[0]).toEqual({
      events: '0',
      usage: '0',
      checkpoints: '0',
      runs: '0',
      messages: '0',
      usage_logs: '0',
    });

    const audit = await pool.query(
      `SELECT payload FROM harness_events
       WHERE project_id = $1 AND type = 'audit.privacy'
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload.action).toBe('delete');
    expect(audit.rows[0].payload.deleted.runs).toBe(1);
  });
});
