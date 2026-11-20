const fs = require('fs');
const { Client } = require('pg');
const {
  SQL_FILES,
  splitSQLStatements,
} = require('../../migrations/apply');

const MIGRATION_056 = SQL_FILES.find((file) => file.endsWith('056_agent_fleet.sql'));
const ROLLBACK_056 = MIGRATION_056.replace(/\.sql$/, '_rollback.sql');
const MIGRATION_057 = MIGRATION_056.replace('056_agent_fleet.sql', '057_agent_fleet_clean_cut.sql');
const ROLLBACK_057 = MIGRATION_057.replace(/\.sql$/, '_rollback.sql');

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

describe('agent fleet additive migration on a seeded database (FR16, NFR5, NFR8)', () => {
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

  it('adds the new schema without disturbing a seeded legacy agent', async () => {
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
    await client.query(
      `INSERT INTO harness_events
         (event_id, trace_id, project_id, agent_id, type)
       VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, 'legacy.event')`,
      [projectId, agentId]
    );

    await applyFile(client, MIGRATION_056);

    const table = async (name) => {
      const result = await client.query('SELECT to_regclass($1) AS name', [name]);
      return result.rows[0].name;
    };

    expect(await table('agent_nodes')).toBeTruthy();
    expect(await table('agent_runtimes')).toBeTruthy();
    // Legacy identity survives the additive phase.
    expect(await table('agents')).toBeTruthy();
    expect(await table('providers')).toBeTruthy();
    expect(await table('agent_enrollment_tokens')).toBeTruthy();

    const legacy = await client.query(
      `SELECT t.assigned_agent_id, t.assigned_runtime_id,
              (SELECT count(*)::int FROM harness_events WHERE agent_id = $1) AS events,
              (SELECT runtime_id FROM harness_events LIMIT 1) AS event_runtime
       FROM tickets t WHERE t.id = $2`,
      [agentId, ticket.rows[0].id]
    );
    expect(String(legacy.rows[0].assigned_agent_id)).toBe(String(agentId));
    expect(legacy.rows[0].assigned_runtime_id).toBeNull();
    expect(legacy.rows[0].events).toBe(1);
    expect(legacy.rows[0].event_runtime).toBeNull();

    await client.query('BEGIN');
    await applyFile(client, ROLLBACK_056);
    await client.query('COMMIT');

    expect(await table('agent_runtimes')).toBeNull();
    expect(await table('agents')).toBeTruthy();
    const still = await client.query('SELECT count(*)::int AS n FROM tickets WHERE assigned_agent_id = $1', [agentId]);
    expect(still.rows[0].n).toBe(1);
  }, 180000);

  it('applies the deferred clean cut after 056 and rolls both back', async () => {
    await applyFile(client, MIGRATION_056);
    await applyFile(client, MIGRATION_057);

    const table = async (name) => {
      const result = await client.query('SELECT to_regclass($1) AS name', [name]);
      return result.rows[0].name;
    };
    expect(await table('agents')).toBeNull();
    expect(await table('providers')).toBeNull();
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tickets' AND column_name IN ('assigned_agent_id','assigned_runtime_id')`
    );
    expect(columns.rows.map((r) => r.column_name).sort()).toEqual(['assigned_runtime_id']);

    await applyFile(client, ROLLBACK_057);
    expect(await table('agents')).toBeTruthy();

    const restored = await client.query(
      `SELECT
         (SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'harness_runs' AND column_name = 'agent_id') AS runs_nullable,
         (SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'harness_leases' AND column_name = 'agent_id') AS leases_nullable,
         to_regclass('public.idx_agents_api_key') IS NOT NULL AS agents_index,
         to_regclass('public.idx_providers_type') IS NOT NULL AS providers_index,
         to_regprocedure('public.release_agent_tickets_on_delete()') IS NOT NULL AS release_fn,
         to_regclass('public.idx_agent_refresh_replays_expiry') IS NOT NULL AS replays_index,
         to_regclass('public.idx_agent_auth_events_created') IS NOT NULL AS auth_events_index`
    );
    expect(restored.rows[0]).toEqual({
      runs_nullable: 'NO',
      leases_nullable: 'NO',
      agents_index: true,
      providers_index: true,
      release_fn: true,
      replays_index: true,
      auth_events_index: true,
    });
    const ticketColumn = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tickets' AND column_name = 'assigned_agent_id'`
    );
    expect(ticketColumn.rows).toHaveLength(1);

    await applyFile(client, ROLLBACK_056);
    expect(await table('agent_runtimes')).toBeNull();
    expect(await table('agents')).toBeTruthy();
  }, 180000);
});
