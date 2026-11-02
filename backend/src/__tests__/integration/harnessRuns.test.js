const { Pool } = require('pg');
const HarnessRunService = require('../../services/HarnessRunService');
const HarnessReaper = require('../../services/HarnessReaper');

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
      `UPDATE tickets
       SET status = 'in_progress', assigned_agent_id = $2, pr_url = NULL
       WHERE id = $1`,
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

  test('refuses a new run for a ticket that already has a PR', async () => {
    await pool.query(
      "UPDATE tickets SET pr_url = 'https://github.com/o/r/pull/9' WHERE id = $1",
      [ticketId]
    );

    await expect(
      start({ branch: 'harness/duplicate-published' })
    ).rejects.toThrow('Ticket is not assigned to this agent');
  });

  test('refuses a new run when an earlier run recorded publish evidence', async () => {
    const run = await start({ branch: 'harness/earlier-published' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      headSha: 'abc123',
    });
    await HarnessRunService.finishRun(run.id, { status: 'failed' });

    await pool.query(
      `UPDATE tickets
       SET status = 'in_progress', assigned_agent_id = $2, pr_url = NULL
       WHERE id = $1`,
      [ticketId, ownerId]
    );

    await expect(
      start({ branch: 'harness/duplicate-evidence' })
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

  test('publish evidence is stored while a run is active', async () => {
    const run = await start({ branch: 'harness/publish-evidence' });

    const updated = await HarnessRunService.recordPublish(run.id, agentId, {
      headSha: 'abc123',
    });
    expect(updated.head_sha).toBe('abc123');

    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/9',
    });
    const stored = await HarnessRunService.getRun(run.id);
    expect(stored.head_sha).toBe('abc123');
    expect(stored.pr_url).toBe('https://github.com/o/r/pull/9');

    await HarnessRunService.finishRun(run.id, { status: 'succeeded' });
    await expect(
      HarnessRunService.recordPublish(run.id, agentId, { headSha: 'later' })
    ).rejects.toThrow('Active harness run not found');
  });

  test('startup recovery sees the latest checkpoint payload', async () => {
    const run = await start({ branch: 'harness/recovery-list' });
    await HarnessRunService.recordCheckpoint(run.id, 'publishing', {
      headSha: 'abc123',
    });

    const runs = await HarnessRunService.listActiveRunsForAgent(agentId);
    const active = runs.find((item) => item.id === run.id);
    expect(active.last_checkpoint_step).toBe('publishing');
    expect(active.last_checkpoint_payload).toEqual({ headSha: 'abc123' });
    expect(active.ticket_status).toBe('in_progress');
    expect(active.ticket_pr_url).toBeNull();
  });

  test('a reaped run releases an in-progress ticket with no PR', async () => {
    const run = await start({ branch: 'harness/reap-release' });
    await HarnessRunService.claimLease({
      ticketId, runId: run.id, agentId, ttlSeconds: 1,
    });
    await pool.query(
      "UPDATE harness_leases SET expires_at = NOW() - INTERVAL '1 second' WHERE ticket_id = $1",
      [ticketId]
    );
    await HarnessRunService.reapExpiredLeases(50, 900);

    const released = await HarnessRunService.releaseTicketForRun(run.id);
    expect(released).not.toBeNull();
    expect(released.status).toBe('backlog');
    expect(released.assigned_agent_id).toBeNull();
  });

  test('a reaped run never resets a reviewed ticket with a PR', async () => {
    const run = await start({ branch: 'harness/reap-review' });
    await pool.query(
      `UPDATE tickets
       SET status = 'review', pr_url = 'https://github.com/o/r/pull/9'
       WHERE id = $1`,
      [ticketId]
    );
    await HarnessRunService.finishRun(run.id, { status: 'failed' });

    await expect(
      HarnessRunService.releaseTicketForRun(run.id)
    ).resolves.toBeNull();

    const stored = await pool.query('SELECT status, pr_url FROM tickets WHERE id = $1', [ticketId]);
    expect(stored.rows[0].status).toBe('review');
    expect(stored.rows[0].pr_url).toBe('https://github.com/o/r/pull/9');
  });

  test('a reaped run with a stored PR is succeeded and adopted, never released', async () => {
    const run = await start({ branch: 'harness/reap-published' });
    await HarnessRunService.claimLease({
      ticketId, runId: run.id, agentId, ttlSeconds: 1,
    });
    await HarnessRunService.recordPublish(run.id, agentId, {
      headSha: 'abc123',
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await pool.query(
      "UPDATE harness_leases SET expires_at = NOW() - INTERVAL '1 second' WHERE ticket_id = $1",
      [ticketId]
    );

    const reaped = await HarnessRunService.reapExpiredLeases(50, 900);
    const row = reaped.find((item) => item.run_id === run.id);
    expect(row).toBeDefined();
    expect(row.run_failed).toBe(false);
    expect((await HarnessRunService.getRun(run.id)).status).toBe('succeeded');

    // The ticket still had no PR, but the run did: release must refuse.
    await expect(
      HarnessRunService.releaseTicketForRun(run.id)
    ).resolves.toBeNull();

    const reconciled = await HarnessRunService.reconcileRun(run.id);
    expect(reconciled.adopted).toBe(true);
    expect(reconciled.released).toBe(false);

    const stored = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(stored.rows[0].status).toBe('review');
    expect(stored.rows[0].pr_url).toBe('https://github.com/o/r/pull/9');
  });

  test('release refuses a failed run that recorded a PR', async () => {
    const run = await start({ branch: 'harness/failed-with-pr' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await HarnessRunService.finishRun(run.id, { status: 'failed' });

    await expect(
      HarnessRunService.releaseTicketForRun(run.id)
    ).resolves.toBeNull();

    const stored = await pool.query('SELECT status, pr_url FROM tickets WHERE id = $1', [ticketId]);
    expect(stored.rows[0].status).toBe('in_progress');
    expect(stored.rows[0].pr_url).toBeNull();
  });

  test('terminal-run reconciliation releases a ticket whose release was interrupted', async () => {
    const run = await start({ branch: 'harness/stranded-failed' });
    await HarnessRunService.finishRun(run.id, { status: 'failed' });

    // Simulate the reaper dying between failing the run and releasing it.
    const pending = await HarnessRunService.listTerminalRunsForReconcile(50);
    expect(pending).toContain(run.id);

    const reconciled = await HarnessRunService.reconcileRun(run.id);
    expect(reconciled.released).toBe(true);
    expect(reconciled.marked).toBe(true);

    const ticket = await pool.query(
      'SELECT status, assigned_agent_id FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('backlog');
    expect(ticket.rows[0].assigned_agent_id).toBeNull();

    const after = await HarnessRunService.listTerminalRunsForReconcile(50);
    expect(after).not.toContain(run.id);
  });

  test('terminal-run reconciliation adopts a published run into review', async () => {
    const run = await start({ branch: 'harness/stranded-published' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      headSha: 'abc123',
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await HarnessRunService.finishRun(run.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/9',
    });

    const reconciled = await HarnessRunService.reconcileRun(run.id);
    expect(reconciled.adopted).toBe(true);
    expect(reconciled.released).toBe(false);

    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('review');
    expect(ticket.rows[0].pr_url).toBe('https://github.com/o/r/pull/9');
  });

  test('terminal-run reconciliation never moves a done ticket back to review', async () => {
    const run = await start({ branch: 'harness/done-ticket' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await HarnessRunService.finishRun(run.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await pool.query(
      `UPDATE tickets
       SET status = 'done', pr_url = 'https://github.com/o/r/pull/9'
       WHERE id = $1`,
      [ticketId]
    );

    await HarnessRunService.reconcileRun(run.id);

    const ticket = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(ticket.rows[0].status).toBe('done');
  });

  test('an old failed run cannot release a ticket for a newer published run', async () => {
    const oldRun = await start({ branch: 'harness/old-failed' });
    await pool.query(
      "UPDATE harness_runs SET started_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
      [oldRun.id]
    );
    await HarnessRunService.finishRun(oldRun.id, { status: 'failed' });

    const newRun = await start({ branch: 'harness/new-published' });
    await HarnessRunService.recordPublish(newRun.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/new',
    });
    await HarnessRunService.finishRun(newRun.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/new',
    });

    // Ticket update was lost: it is still in_progress.
    const before = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(before.rows[0].status).toBe('in_progress');

    const oldReconciled = await HarnessRunService.reconcileRun(oldRun.id);
    expect(oldReconciled.released).toBe(false);
    expect(oldReconciled.adopted).toBe(false);
    expect(oldReconciled.marked).toBe(true);

    const afterOld = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(afterOld.rows[0].status).toBe('in_progress');
    expect(afterOld.rows[0].pr_url).toBeNull();

    const newReconciled = await HarnessRunService.reconcileRun(newRun.id);
    expect(newReconciled.adopted).toBe(true);
    expect(newReconciled.released).toBe(false);

    const afterNew = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(afterNew.rows[0].status).toBe('review');
    expect(afterNew.rows[0].pr_url).toBe('https://github.com/o/r/pull/new');
  });

  test('an old published run does not overwrite a newer ticket PR', async () => {
    const run = await start({ branch: 'harness/old-published' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/old',
    });
    await HarnessRunService.finishRun(run.id, {
      status: 'failed',
      prUrl: 'https://github.com/o/r/pull/old',
    });
    await pool.query(
      `UPDATE tickets
       SET status = 'review', pr_url = 'https://github.com/o/r/pull/new'
       WHERE id = $1`,
      [ticketId]
    );

    const reconciled = await HarnessRunService.reconcileRun(run.id);
    expect(reconciled.adopted).toBe(true);

    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('review');
    expect(ticket.rows[0].pr_url).toBe('https://github.com/o/r/pull/new');

    // The run evidence still wins its own status: a failed run with a PR is
    // promoted to succeeded during reconciliation.
    const stored = await HarnessRunService.getRun(run.id);
    expect(stored.status).toBe('succeeded');
  });

  test('a newer failed run does not release over an older published run', async () => {
    const oldRun = await start({ branch: 'harness/older-published' });
    await pool.query(
      "UPDATE harness_runs SET started_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
      [oldRun.id]
    );
    await HarnessRunService.finishRun(oldRun.id, { status: 'failed' });

    const newRun = await start({ branch: 'harness/newer-failed' });
    await HarnessRunService.finishRun(newRun.id, { status: 'failed' });
    await pool.query(
      `UPDATE harness_runs
       SET pr_url = 'https://github.com/o/r/pull/old'
       WHERE id = $1`,
      [oldRun.id]
    );

    const oldReconciled = await HarnessRunService.reconcileRun(oldRun.id);
    expect(oldReconciled.adopted).toBe(false);
    expect(oldReconciled.released).toBe(false);

    const newReconciled = await HarnessRunService.reconcileRun(newRun.id);
    expect(newReconciled.released).toBe(false);

    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('in_progress');
    expect(ticket.rows[0].pr_url).toBeNull();
  });

  test('an old published run does not adopt while a newer run is active', async () => {
    const oldRun = await start({ branch: 'harness/old-published-active' });
    await pool.query(
      "UPDATE harness_runs SET started_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
      [oldRun.id]
    );
    await HarnessRunService.finishRun(oldRun.id, { status: 'failed' });

    const active = await start({ branch: 'harness/new-active' });
    await pool.query(
      `UPDATE harness_runs
       SET pr_url = 'https://github.com/o/r/pull/old'
       WHERE id = $1`,
      [oldRun.id]
    );

    const reconciled = await HarnessRunService.reconcileRun(oldRun.id);
    expect(reconciled.adopted).toBe(false);
    expect(reconciled.released).toBe(false);

    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('in_progress');
    expect(ticket.rows[0].pr_url).toBeNull();

    await HarnessRunService.finishRun(active.id, { status: 'failed' });
  });

  test('reconciliation is a one-time ticket update', async () => {
    const run = await start({ branch: 'harness/reconcile-once' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/first',
    });
    await HarnessRunService.finishRun(run.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/first',
    });

    const first = await HarnessRunService.reconcileRun(run.id);
    expect(first.adopted).toBe(true);

    await pool.query(
      "UPDATE tickets SET pr_url = 'https://github.com/o/r/pull/newer' WHERE id = $1",
      [ticketId]
    );

    const second = await HarnessRunService.reconcileRun(run.id);
    expect(second.marked).toBe(false);
    expect(second.adopted).toBe(false);
    expect(second.released).toBe(false);

    const ticket = await pool.query('SELECT pr_url FROM tickets WHERE id = $1', [ticketId]);
    expect(ticket.rows[0].pr_url).toBe('https://github.com/o/r/pull/newer');
  });

  test('adopting published work moves a backlog ticket to review', async () => {
    const run = await start({ branch: 'harness/backlog-published' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await HarnessRunService.finishRun(run.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await pool.query(
      "UPDATE tickets SET status = 'backlog' WHERE id = $1",
      [ticketId]
    );

    await HarnessRunService.reconcileRun(run.id);

    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('review');
    expect(ticket.rows[0].pr_url).toBe('https://github.com/o/r/pull/9');
  });

  test('a succeeded run without a PR is left for operator handling', async () => {
    const run = await start({ branch: 'harness/succeeded-no-pr' });
    await HarnessRunService.finishRun(run.id, { status: 'succeeded' });

    const reconciled = await HarnessRunService.reconcileRun(run.id);
    expect(reconciled.adopted).toBe(false);
    expect(reconciled.released).toBe(false);
    expect(reconciled.needs_operator).toBe(true);

    const ticket = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(ticket.rows[0].status).toBe('in_progress');
  });

  test('release refuses a failed run that recorded a head sha without a PR', async () => {
    const run = await start({ branch: 'harness/head-only' });
    await HarnessRunService.recordPublish(run.id, agentId, { headSha: 'abc123' });
    await HarnessRunService.finishRun(run.id, { status: 'failed' });

    await expect(
      HarnessRunService.releaseTicketForRun(run.id)
    ).resolves.toBeNull();

    const ticket = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(ticket.rows[0].status).toBe('in_progress');
  });

  test('reaper reconciles a terminal run stranded by an earlier sweep', async () => {
    const run = await start({ branch: 'harness/reaper-stranded' });
    await HarnessRunService.finishRun(run.id, { status: 'failed' });

    const summary = await HarnessReaper.runOnce();

    expect(summary.released).toBeGreaterThanOrEqual(1);
    const ticket = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(ticket.rows[0].status).toBe('backlog');

    const stored = await HarnessRunService.getRun(run.id);
    expect(stored.reconciled_at).not.toBeNull();
  });

  test('reaper adopts the newest run when an older failed run is also pending', async () => {
    const oldRun = await start({ branch: 'harness/reaper-old' });
    await pool.query(
      "UPDATE harness_runs SET started_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
      [oldRun.id]
    );
    await HarnessRunService.finishRun(oldRun.id, { status: 'failed' });

    const newRun = await start({ branch: 'harness/reaper-new' });
    await HarnessRunService.recordPublish(newRun.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/new',
    });
    await HarnessRunService.finishRun(newRun.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/new',
    });

    await HarnessReaper.runOnce();

    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('review');
    expect(ticket.rows[0].pr_url).toBe('https://github.com/o/r/pull/new');

    const oldStored = await HarnessRunService.getRun(oldRun.id);
    expect(oldStored.reconciled_at).not.toBeNull();
  });

  test('reaper adopts a published terminal run into review', async () => {
    const run = await start({ branch: 'harness/reaper-published' });
    await HarnessRunService.recordPublish(run.id, agentId, {
      prUrl: 'https://github.com/o/r/pull/9',
    });
    await HarnessRunService.finishRun(run.id, {
      status: 'succeeded',
      prUrl: 'https://github.com/o/r/pull/9',
    });

    const summary = await HarnessReaper.runOnce();

    expect(summary.adopted).toBeGreaterThanOrEqual(1);
    const ticket = await pool.query(
      'SELECT status, pr_url FROM tickets WHERE id = $1',
      [ticketId]
    );
    expect(ticket.rows[0].status).toBe('review');
    expect(ticket.rows[0].pr_url).toBe('https://github.com/o/r/pull/9');
  });

  test('an old failed run cannot release a ticket owned by a newer active run', async () => {
    const first = await start({ branch: 'harness/old-run' });
    await HarnessRunService.finishRun(first.id, { status: 'failed' });
    await start({ branch: 'harness/new-run' });

    await expect(
      HarnessRunService.releaseTicketForRun(first.id)
    ).resolves.toBeNull();

    const stored = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(stored.rows[0].status).toBe('in_progress');
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
