const fs = require('fs');
const { Client } = require('pg');
const {
  SQL_FILES,
  splitSQLStatements,
} = require('../../migrations/apply');

const MIGRATION_056 = SQL_FILES.find((file) =>
  file.endsWith('056_agent_fleet.sql')
);
const ROLLBACK_056 = MIGRATION_056.replace(/\.sql$/, '_rollback.sql');

function databaseUrlWithName(name) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function applyFile(client, file) {
  const sql = fs.readFileSync(file, 'utf8');
  for (const statement of splitSQLStatements(sql)) {
    await client.query(statement);
  }
}

describe('agent fleet migration on a seeded database (FR16, NFR5, NFR8)', () => {
  let admin;
  let client;
  let dbName;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }

    admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();

    dbName = `fg54_mig_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);

    client = new Client({ connectionString: databaseUrlWithName(dbName) });
    await client.connect();

    for (const file of SQL_FILES) {
      if (file.endsWith('056_agent_fleet.sql')) continue;
      await applyFile(client, file);
    }
  }, 180000);

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
    if (admin && dbName) {
      await admin
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
          [dbName]
        )
        .catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
      await admin.end().catch(() => {});
    }
  }, 60000);

  it('migrates seeded legacy rows without carrying ids or history', async () => {
    const user = await client.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ('fg54-mig@test.local', 'FG54', 'x') RETURNING id`
    );
    const userId = user.rows[0].id;
    const project = await client.query(
      `INSERT INTO projects (name, owner_id) VALUES ('fg54', $1) RETURNING id`,
      [userId]
    );
    const projectId = project.rows[0].id;
    const agent = await client.query(
      `INSERT INTO agents (name, owner_id, project_id)
       VALUES ('legacy-agent', $1, $2) RETURNING id`,
      [userId, projectId]
    );
    const agentId = agent.rows[0].id;
    const ticket = await client.query(
      `INSERT INTO tickets (project_id, title, owner_id, status, assigned_agent_id, locked_at)
       VALUES ($1, 'legacy ticket', $2, 'in_progress', $3, NOW()) RETURNING id`,
      [projectId, userId, agentId]
    );
    const ticketId = ticket.rows[0].id;
    const run = await client.query(
      `INSERT INTO harness_runs (ticket_id, agent_id, branch)
       VALUES ($1, $2, 'legacy-branch') RETURNING id`,
      [ticketId, agentId]
    );
    const runId = run.rows[0].id;

    await client.query(
      `INSERT INTO harness_leases (ticket_id, run_id, agent_id, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 hour')`,
      [ticketId, runId, agentId]
    );
    await client.query(
      `INSERT INTO agent_heartbeats (agent_id) VALUES ($1)`,
      [agentId]
    );
    await client.query(
      `INSERT INTO agent_actions (agent_id, action_type) VALUES ($1, 'legacy')`,
      [agentId]
    );
    await client.query(
      `INSERT INTO usage_logs (project_id, agent_id, provider_type, model)
       VALUES ($1, $2, 'claude', 'legacy-model')`,
      [projectId, agentId]
    );
    await client.query(
      `INSERT INTO telemetry_events
         (content_hash, provider_type, model, agent_id, project_id)
       VALUES ('legacy-hash', 'claude', 'legacy-model', $1, $2)`,
      [agentId, projectId]
    );
    await client.query(
      `INSERT INTO harness_usage (run_id, project_id, agent_id, model)
       VALUES ($1, $2, $3, 'legacy-model')`,
      [runId, projectId, agentId]
    );
    const profile = await client.query(
      `INSERT INTO repo_profiles (project_id, version, profile)
       VALUES ($1, 1, '{}'::jsonb) RETURNING id`,
      [projectId]
    );
    await client.query(
      `INSERT INTO repo_profile_validations
         (project_id, profile_id, profile_version, profile, agent_id)
       VALUES ($1, $2, 1, '{}'::jsonb, $3)`,
      [projectId, profile.rows[0].id, agentId]
    );
    await client.query(
      `INSERT INTO harness_events
         (event_id, trace_id, project_id, agent_id, type)
       VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, 'legacy.event')`,
      [projectId, agentId]
    );

    await applyFile(client, MIGRATION_056);

    const table = async (name) => {
      const result = await client.query(
        `SELECT to_regclass($1) AS name`,
        [name]
      );
      return result.rows[0].name;
    };

    expect(await table('agent_nodes')).toBeTruthy();
    expect(await table('agent_runtimes')).toBeTruthy();
    expect(await table('agents')).toBeNull();
    expect(await table('providers')).toBeNull();

    const counts = await client.query(
      `SELECT
         (SELECT count(*)::int FROM harness_runs) AS runs,
         (SELECT count(*)::int FROM harness_leases) AS leases,
         (SELECT count(*)::int FROM agent_heartbeats) AS heartbeats`
    );
    expect(counts.rows[0]).toEqual({ runs: 0, leases: 0, heartbeats: 0 });

    const cleared = await client.query(
      `SELECT
         (SELECT count(*)::int FROM usage_logs WHERE runtime_id IS NOT NULL) AS usage_ids,
         (SELECT count(*)::int FROM telemetry_events WHERE runtime_id IS NOT NULL) AS telemetry_ids,
         (SELECT count(*)::int FROM harness_usage WHERE runtime_id IS NOT NULL) AS harness_usage_ids,
         (SELECT count(*)::int FROM agent_actions WHERE runtime_id IS NOT NULL) AS action_ids,
         (SELECT count(*)::int FROM repo_profile_validations WHERE runtime_id IS NOT NULL) AS validation_ids,
         (SELECT count(*)::int FROM tickets WHERE assigned_runtime_id IS NOT NULL) AS ticket_ids`
    );
    expect(cleared.rows[0]).toEqual({
      usage_ids: 0,
      telemetry_ids: 0,
      harness_usage_ids: 0,
      action_ids: 0,
      validation_ids: 0,
      ticket_ids: 0,
    });

    const event = await client.query(
      `SELECT agent_id, runtime_id FROM harness_events LIMIT 1`
    );
    expect(event.rows[0].agent_id).toBe(String(agentId));
    expect(event.rows[0].runtime_id).toBeNull();

    const node = await client.query(
      `INSERT INTO agent_nodes (owner_id, name) VALUES ($1, 'node') RETURNING id`,
      [userId]
    );
    const credential = await client.query(
      `INSERT INTO provider_credentials
         (owner_id, name, provider_type, api_key_encrypted)
       VALUES ($1, 'cred', 'claude', 'enc') RETURNING id`,
      [userId]
    );
    const model = await client.query(
      `INSERT INTO provider_models
         (credential_id, model, source, status, roles)
       VALUES ($1, 'm', 'manual', 'verified', ARRAY['worker']) RETURNING id`,
      [credential.rows[0].id]
    );
    const runtime = await client.query(
      `INSERT INTO agent_runtimes (node_id, name, role, model_id)
       VALUES ($1, 'worker-1', 'worker', $2) RETURNING id`,
      [node.rows[0].id, model.rows[0].id]
    );
    expect(runtime.rows[0].id).toBeTruthy();

    await client.query('BEGIN');
    await applyFile(client, ROLLBACK_056);
    await client.query('COMMIT');

    expect(await table('agents')).toBeTruthy();
    expect(await table('providers')).toBeTruthy();
    expect(await table('agent_runtimes')).toBeNull();

    const renamedBack = await client.query(
      `SELECT
         (SELECT count(*)::int FROM information_schema.columns
          WHERE table_name = 'tickets' AND column_name = 'assigned_agent_id') AS ticket_col,
         (SELECT count(*)::int FROM information_schema.columns
          WHERE table_name = 'harness_events' AND column_name = 'runtime_id') AS event_col`
    );
    expect(renamedBack.rows[0]).toEqual({ ticket_col: 1, event_col: 0 });
  }, 180000);
});
