const { Pool } = require('pg');
const HarnessRunService = require('../../services/HarnessRunService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('HarnessRunService — PostgreSQL integration', () => {
  let ownerId;
  let otherOwnerId;
  let agentId;
  let otherAgentId;
  let ticketId;
  let otherTicketId;

  beforeAll(async () => {
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Harness Owner', 'x', 'project_admin') RETURNING id`,
      [`harness_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;

    const otherOwner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Harness Other', 'x', 'project_admin') RETURNING id`,
      [`harness_other_${suffix}@test.com`]
    );
    otherOwnerId = otherOwner.rows[0].id;

    const project = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`Harness Project ${suffix}`, ownerId]
    );

    const otherProject = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`Harness Other Project ${suffix}`, otherOwnerId]
    );

    const ticket = await pool.query(
      `INSERT INTO tickets (project_id, title, status, owner_id, assigned_agent_id)
       VALUES ($1, 'Harness ticket', 'in_progress', $2, $2) RETURNING id`,
      [project.rows[0].id, ownerId]
    );
    ticketId = ticket.rows[0].id;

    const otherTicket = await pool.query(
      `INSERT INTO tickets (project_id, title, status, owner_id, assigned_agent_id)
       VALUES ($1, 'Other harness ticket', 'in_progress', $2, $2) RETURNING id`,
      [otherProject.rows[0].id, otherOwnerId]
    );
    otherTicketId = otherTicket.rows[0].id;

    const agent = await pool.query(
      `INSERT INTO agents (name, api_key, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`harness-agent-${suffix}`, `key_${suffix}`, ownerId]
    );
    agentId = agent.rows[0].id;

    const otherAgent = await pool.query(
      `INSERT INTO agents (name, api_key, owner_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [`harness-other-agent-${suffix}`, `other_key_${suffix}`, otherOwnerId]
    );
    otherAgentId = otherAgent.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[ownerId, otherOwnerId]]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM harness_runs WHERE ticket_id = ANY($1)', [
      [ticketId, otherTicketId],
    ]);
    await pool.query(
      "UPDATE tickets SET status = 'in_progress', assigned_agent_id = $2 WHERE id = $1",
      [ticketId, ownerId]
    );
  });

  const start = (overrides = {}) => HarnessRunService.startRun({
    ticketId,
    agentId,
    branch: overrides.branch || `harness/test-${Math.random()}`,
    ...overrides,
  });

  test('rejects a run for a ticket assigned to another owner', async () => {
    await expect(
      HarnessRunService.startRun({ ticketId, agentId: otherAgentId, branch: 'cross/ticket' })
    ).rejects.toThrow('Ticket is not assigned to this agent');
  });

  test('allows only one running run per ticket', async () => {
    await start({ branch: 'harness/first' });

    await expect(start({ branch: 'harness/second' }))
      .rejects.toThrow('Ticket already has an active harness run');
  });

  test('concurrent starts for the same ticket produce exactly one winner', async () => {
    const results = await Promise.allSettled([
      start({ branch: 'harness/race-a' }),
      start({ branch: 'harness/race-b' }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toContain('active harness run');
  });

  test('an unexpired lease blocks a different run', async () => {
    const first = await start({ branch: 'harness/first' });
    const lease = await HarnessRunService.claimLease({
      ticketId, runId: first.id, agentId, ttlSeconds: 60,
    });
    expect(lease).not.toBeNull();

    await HarnessRunService.finishRun(first.id, { status: 'failed' });

    // Recreate a lease that outlives the finished run, as if another live
    // process still owned it.
    await pool.query(
      `INSERT INTO harness_leases (ticket_id, run_id, agent_id, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 minute')`,
      [ticketId, first.id, agentId]
    );
    const second = await start({ branch: 'harness/second' });

    await expect(
      HarnessRunService.claimLease({ ticketId, runId: second.id, agentId, ttlSeconds: 60 })
    ).resolves.toBeNull();
  });

  test('expired leases are reaped and their runs failed', async () => {
    const run = await start({ branch: 'harness/expired' });
    await HarnessRunService.claimLease({
      ticketId, runId: run.id, agentId, ttlSeconds: 1,
    });

    await pool.query(
      "UPDATE harness_leases SET expires_at = NOW() - INTERVAL '1 second' WHERE ticket_id = $1",
      [ticketId]
    );

    const reaped = await HarnessRunService.reapExpiredLeases(50, 900);
    const row = reaped.find((item) => item.run_id === run.id);

    expect(row).toBeDefined();
    expect(row.run_failed).toBe(true);

    const stored = await HarnessRunService.getRun(run.id);
    expect(stored.status).toBe('failed');
    expect(stored.step).not.toBe('reaped');

    const leases = await pool.query(
      'SELECT 1 FROM harness_leases WHERE run_id = $1',
      [run.id]
    );
    expect(leases.rows).toHaveLength(0);
  });

  test('orphaned running runs without a lease are reaped after a stale heartbeat', async () => {
    const run = await start({ branch: 'harness/orphan' });
    await pool.query(
      "UPDATE harness_runs SET heartbeat_at = NOW() - INTERVAL '2 hours' WHERE id = $1",
      [run.id]
    );

    const reaped = await HarnessRunService.reapExpiredLeases(50, 60);
    const row = reaped.find((item) => item.run_id === run.id);

    expect(row).toBeDefined();
    expect(row.run_failed).toBe(true);
    expect((await HarnessRunService.getRun(run.id)).status).toBe('failed');
  });

  test('finish is idempotent and releases the lease', async () => {
    const run = await start({ branch: 'harness/finish' });
    await HarnessRunService.claimLease({
      ticketId, runId: run.id, agentId, ttlSeconds: 60,
    });

    const finished = await HarnessRunService.finishRun(run.id, {
      status: 'succeeded',
      headSha: 'abc123',
      prUrl: 'https://github.com/o/r/pull/1',
    });
    expect(finished.status).toBe('succeeded');

    const again = await HarnessRunService.finishRun(run.id, { status: 'failed' });
    expect(again.status).toBe('succeeded');

    const leases = await pool.query(
      'SELECT 1 FROM harness_leases WHERE run_id = $1',
      [run.id]
    );
    expect(leases.rows).toHaveLength(0);
  });

  test('checkpoints after finish are rejected and steps never move backwards', async () => {
    const run = await start({ branch: 'harness/checkpoints' });

    await HarnessRunService.recordCheckpoint(run.id, 'cloned', { baseSha: 'abc' });
    await expect(
      HarnessRunService.recordCheckpoint(run.id, 'created')
    ).rejects.toThrow('would move the run backwards');

    await HarnessRunService.finishRun(run.id, { status: 'failed' });
    await expect(
      HarnessRunService.recordCheckpoint(run.id, 'verifying')
    ).rejects.toThrow('Active harness run not found');
  });

  test('checkpoint context populates workspace, session and base sha', async () => {
    const run = await start({ branch: 'harness/context' });

    await HarnessRunService.recordCheckpoint(run.id, 'cloned', {
      workspacePath: '/tmp/workspace',
      baseSha: 'base123',
    });
    await HarnessRunService.recordCheckpoint(run.id, 'session_ready', {
      sessionId: 'ses_123',
    });

    const stored = await HarnessRunService.getRun(run.id);
    expect(stored.workspace_path).toBe('/tmp/workspace');
    expect(stored.base_sha).toBe('base123');
    expect(stored.session_id).toBe('ses_123');
    expect(stored.step).toBe('session_ready');
  });

  test('a different agent cannot claim the run lease', async () => {
    const run = await start({ branch: 'harness/wrong-agent' });

    await expect(
      HarnessRunService.claimLease({
        ticketId, runId: run.id, agentId: otherAgentId, ttlSeconds: 60,
      })
    ).resolves.toBeNull();
  });

  test('renewal fails after the ticket is released or the run becomes terminal', async () => {
    const run = await start({ branch: 'harness/renew' });
    await HarnessRunService.claimLease({
      ticketId, runId: run.id, agentId, ttlSeconds: 60,
    });

    await pool.query(
      "UPDATE tickets SET status = 'backlog', assigned_agent_id = NULL WHERE id = $1",
      [ticketId]
    );
    await expect(
      HarnessRunService.renewLease({ ticketId, runId: run.id, agentId, ttlSeconds: 60 })
    ).resolves.toBeNull();

    await pool.query(
      "UPDATE tickets SET status = 'in_progress', assigned_agent_id = $2 WHERE id = $1",
      [ticketId, ownerId]
    );
    await pool.query("UPDATE harness_runs SET status = 'failed' WHERE id = $1", [run.id]);
    await expect(
      HarnessRunService.renewLease({ ticketId, runId: run.id, agentId, ttlSeconds: 60 })
    ).resolves.toBeNull();
  });
});
