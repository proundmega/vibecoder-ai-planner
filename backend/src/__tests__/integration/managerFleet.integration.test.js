'use strict';

/**
 * fg-54 manager/lease integration (FR13/FR14/NFR4/NFR8).
 *
 * These tests exercise the contract schema owned by track A. Before track A's
 * `056_agent_fleet.sql` is merged the suite is skipped; set
 * `REQUIRE_FLEET_SCHEMA=1` in the joint integration job to turn a missing
 * schema into a failure instead of a skip.
 */

const { pool } = require('../../db');
const { runWithLock } = require('../../manager');
const {
  staleClaimSweep,
  enrollmentTokenCleanup,
  heartbeatExpiry,
} = require('../../manager/jobs');

const requireSchema = process.env.REQUIRE_FLEET_SCHEMA === '1';
let schemaReady = false;
const ids = {};

async function detectSchema() {
  const result = await pool.query(
    `SELECT
       to_regclass('public.agent_nodes') IS NOT NULL AS nodes,
       to_regclass('public.agent_runtimes') IS NOT NULL AS runtimes,
       to_regclass('public.provider_credentials') IS NOT NULL AS credentials,
       to_regclass('public.provider_models') IS NOT NULL AS models,
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tickets' AND column_name = 'assigned_runtime_id'
       ) AS claim_column`
  );
  const row = result.rows[0] || {};
  return Boolean(row.nodes && row.runtimes && row.credentials && row.models && row.claim_column);
}

async function seedRun() {
  const suffix = Date.now();
  const user = await pool.query(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'x') RETURNING id",
    [`fg54-manager-${suffix}@example.test`, 'fg54 manager']
  );
  ids.user = user.rows[0].id;
  const project = await pool.query(
    'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
    [`fg54-project-${suffix}`, ids.user]
  );
  ids.project = project.rows[0].id;
  const credential = await pool.query(
    `INSERT INTO provider_credentials (owner_id, name, provider_type, api_key_encrypted)
     VALUES ($1, $2, 'openai', 'encrypted') RETURNING id`,
    [ids.user, `cred-${suffix}`]
  );
  ids.credential = credential.rows[0].id;
  const model = await pool.query(
    `INSERT INTO provider_models (credential_id, model, source, status)
     VALUES ($1, $2, 'manual', 'verified') RETURNING id`,
    [ids.credential, `model-${suffix}`]
  );
  ids.model = model.rows[0].id;
  const node = await pool.query(
    'INSERT INTO agent_nodes (owner_id, name) VALUES ($1, $2) RETURNING id',
    [ids.user, `node-${suffix}`]
  );
  ids.node = node.rows[0].id;
  const runtime = await pool.query(
    `INSERT INTO agent_runtimes (node_id, name, role, model_id, status)
     VALUES ($1, $2, 'worker', $3, 'running') RETURNING id`,
    [ids.node, `runtime-${suffix}`, ids.model]
  );
  ids.runtime = runtime.rows[0].id;
  const ticket = await pool.query(
    `INSERT INTO tickets (project_id, title, status, owner_id, assigned_runtime_id, locked_at)
     VALUES ($1, 'fg54 stale claim', 'in_progress', $2, $3, NOW() - INTERVAL '2 hours')
     RETURNING id`,
    [ids.project, ids.user, ids.runtime]
  );
  ids.ticket = ticket.rows[0].id;

  const leaseColumn = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'harness_leases' AND column_name IN ('runtime_id', 'agent_id')`
  );
  const runtimeColumn = leaseColumn.rows[0] ? leaseColumn.rows[0].column_name : 'agent_id';
  const run = await pool.query(
    `INSERT INTO harness_runs (ticket_id, ${runtimeColumn}, branch, status)
     VALUES ($1, $2, 'fg54/manager-test', 'running') RETURNING id`,
    [ids.ticket, ids.runtime]
  );
  ids.run = run.rows[0].id;
  await pool.query(
    `INSERT INTO harness_leases (ticket_id, run_id, ${runtimeColumn}, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
    [ids.ticket, ids.run, ids.runtime]
  );
}

async function cleanup() {
  if (ids.ticket) await pool.query('DELETE FROM tickets WHERE id = $1', [ids.ticket]);
  if (ids.node) await pool.query('DELETE FROM agent_nodes WHERE id = $1', [ids.node]);
  if (ids.credential) await pool.query('DELETE FROM provider_credentials WHERE id = $1', [ids.credential]);
  if (ids.project) await pool.query('DELETE FROM projects WHERE id = $1', [ids.project]);
  if (ids.user) await pool.query('DELETE FROM users WHERE id = $1', [ids.user]);
  for (const key of Object.keys(ids)) delete ids[key];
}

describe('fg-54 manager integration', () => {
  beforeAll(async () => {
    try {
      schemaReady = await detectSchema();
    } catch (error) {
      schemaReady = false;
    }
    if (!schemaReady && requireSchema) {
      throw new Error('fg-54 fleet schema is missing; run 056_agent_fleet.sql first');
    }
    if (!schemaReady) {
      console.warn('fg-54 fleet schema is not present yet; integration tests are skipped');
    }
  });

  afterAll(async () => {
    await cleanup().catch(() => {});
    await pool.end();
  });

  test('FR14 stale sweep never releases a ticket with an unexpired run lease', async () => {
    if (!schemaReady) return;
    await seedRun();

    const first = await staleClaimSweep(pool, { staleMinutes: 60 });
    expect(first.released).not.toContain(ids.ticket);

    await pool.query(
      'UPDATE harness_leases SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE ticket_id = $1',
      [ids.ticket]
    );
    const second = await staleClaimSweep(pool, { staleMinutes: 60 });
    expect(second.released).toContain(ids.ticket);

    const row = await pool.query(
      'SELECT status, assigned_runtime_id, locked_at FROM tickets WHERE id = $1',
      [ids.ticket]
    );
    expect(row.rows[0].status).toBe('backlog');
    expect(row.rows[0].assigned_runtime_id).toBeNull();
    expect(row.rows[0].locked_at).toBeNull();
  });

  test('FR13/NFR4 two manager replicas produce one advisory-lock effect', async () => {
    const ran = [];
    const [first, second] = await Promise.all([
      runWithLock('fg54-integration-probe', async () => {
        ran.push('first');
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { processed: 1 };
      }),
      runWithLock('fg54-integration-probe', async () => {
        ran.push('second');
        return { processed: 1 };
      }),
    ]);

    const applied = [first, second].filter((row) => row.processed === 1);
    const skipped = [first, second].filter((row) => String(row.skipped || '').includes('another replica'));
    expect(applied).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(ran).toEqual(['first']);

    // The lock is released after the job, so a later tick can run again.
    const third = await runWithLock('fg54-integration-probe', async () => ({ processed: 2 }));
    expect(third.processed).toBe(2);
  });

  test('FR14 cleanup and heartbeat jobs are idempotent on the real schema', async () => {
    if (!schemaReady) return;
    await seedRun();

    const cleanupFirst = await enrollmentTokenCleanup(pool, { retentionDays: 30 });
    const cleanupSecond = await enrollmentTokenCleanup(pool, { retentionDays: 30 });
    expect(cleanupSecond.processed).toBe(0);

    await pool.query(
      "UPDATE agent_runtimes SET status = 'running', last_seen_at = NOW() - INTERVAL '10 minutes' WHERE id = $1",
      [ids.runtime]
    );
    const expiryFirst = await heartbeatExpiry(pool, { staleSeconds: 120 });
    const expirySecond = await heartbeatExpiry(pool, { staleSeconds: 120 });
    expect(expiryFirst.stoppedRuntimes).toContain(ids.runtime);
    expect(expirySecond.stoppedRuntimes).not.toContain(ids.runtime);
    expect(cleanupFirst.processed).toBeGreaterThanOrEqual(0);
  });
