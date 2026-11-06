const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FORWARD_SQL = path.join(__dirname, '../../migrations/048_ticket_assigned_agent_fk.sql');
const ROLLBACK_SQL = path.join(__dirname, '../../migrations/048_ticket_assigned_agent_fk_rollback.sql');
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Migration 048 backfill (real DB, transactional)', () => {
  let client;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  test('backfills the oldest agent, releases unmapped tickets, preserves status, is idempotent and rolls back', async () => {
    await client.query('BEGIN');

    try {
      // Simulate the pre-048 schema and data.
      await client.query('DROP TRIGGER IF EXISTS release_agent_tickets_on_delete ON agents');
      await client.query('ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_agent_id_agent_fkey');
      await client.query('ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_assigned_agent_id_fkey');
      await client.query('UPDATE tickets SET assigned_agent_id = NULL, locked_at = NULL');
      await client.query(
        `ALTER TABLE tickets
         ADD CONSTRAINT tickets_assigned_agent_id_fkey
         FOREIGN KEY (assigned_agent_id) REFERENCES users(id) NOT VALID`
      );

      const owner = await client.query(
        `INSERT INTO users (email, name, password_hash, role)
         VALUES ($1, 'Backfill Owner', 'x', 'user') RETURNING id`,
        [`backfill_owner_${suffix}@test.com`]
      );
      const ownerId = owner.rows[0].id;

      const ownerWithoutAgent = await client.query(
        `INSERT INTO users (email, name, password_hash, role)
         VALUES ($1, 'No Agent Owner', 'x', 'user') RETURNING id`,
        [`backfill_orphan_${suffix}@test.com`]
      );
      const orphanOwnerId = ownerWithoutAgent.rows[0].id;

      const firstAgent = await client.query(
        `INSERT INTO agents (name, api_key, owner_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [`backfill-oldest-${suffix}`, `key_oldest_${suffix}`, ownerId]
      );
      const oldestAgentId = firstAgent.rows[0].id;

      await client.query(
        `INSERT INTO agents (name, api_key, owner_id)
         VALUES ($1, $2, $3)`,
        [`backfill-newer-${suffix}`, `key_newer_${suffix}`, ownerId]
      );

      const project = await client.query(
        `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [`Backfill Project ${suffix}`, ownerId]
      );
      const projectId = project.rows[0].id;

      const insertTicket = (title, status, assignedTo) => client.query(
        `INSERT INTO tickets (project_id, title, status, owner_id, assigned_agent_id, locked_at)
         VALUES ($1, $2, $3::text, $4, $5, CASE WHEN $3::text = 'in_progress' THEN NOW() ELSE NULL END)
         RETURNING id`,
        [projectId, title, status, ownerId, assignedTo]
      );

      const inProgress = await insertTicket('in progress', 'in_progress', ownerId);
      const unmapped = await insertTicket('unmapped', 'in_progress', orphanOwnerId);
      const review = await insertTicket('review', 'review', ownerId);
      const done = await insertTicket('done', 'done', ownerId);

      await client.query(fs.readFileSync(FORWARD_SQL, 'utf8'));

      const read = async (ticketId) => {
        const result = await client.query(
          'SELECT status, assigned_agent_id, locked_at FROM tickets WHERE id = $1',
          [ticketId]
        );
        return result.rows[0];
      };

      const mapped = await read(inProgress.rows[0].id);
      expect(String(mapped.assigned_agent_id)).toBe(String(oldestAgentId));
      expect(mapped.status).toBe('in_progress');

      const released = await read(unmapped.rows[0].id);
      expect(released.assigned_agent_id).toBeNull();
      expect(released.locked_at).toBeNull();
      expect(released.status).toBe('backlog');

      const keptReview = await read(review.rows[0].id);
      expect(String(keptReview.assigned_agent_id)).toBe(String(oldestAgentId));
      expect(keptReview.status).toBe('review');

      const keptDone = await read(done.rows[0].id);
      expect(String(keptDone.assigned_agent_id)).toBe(String(oldestAgentId));
      expect(keptDone.status).toBe('done');

      const fk = await client.query(
        `SELECT ccu.table_name AS ref_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = current_schema()
           AND tc.table_name = 'tickets'
           AND tc.constraint_name = 'tickets_assigned_agent_id_agent_fkey'`
      );
      expect(fk.rows[0].ref_table).toBe('agents');

      const trigger = await client.query(
        "SELECT tgname FROM pg_trigger WHERE tgname = 'release_agent_tickets_on_delete'"
      );
      expect(trigger.rows).toHaveLength(1);

      // Re-running 048 must not change anything.
      await client.query(fs.readFileSync(FORWARD_SQL, 'utf8'));
      const rerun = await read(inProgress.rows[0].id);
      expect(String(rerun.assigned_agent_id)).toBe(String(oldestAgentId));
      const rerunReleased = await read(unmapped.rows[0].id);
      expect(rerunReleased.status).toBe('backlog');

      // Rollback restores owner ids and the users FK.
      await client.query(fs.readFileSync(ROLLBACK_SQL, 'utf8'));

      const rolledBack = await read(inProgress.rows[0].id);
      expect(String(rolledBack.assigned_agent_id)).toBe(String(ownerId));

      const rolledBackReview = await read(review.rows[0].id);
      expect(String(rolledBackReview.assigned_agent_id)).toBe(String(ownerId));
      expect(rolledBackReview.status).toBe('review');

      const userFk = await client.query(
        `SELECT ccu.table_name AS ref_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = current_schema()
           AND tc.table_name = 'tickets'
           AND tc.constraint_name = 'tickets_assigned_agent_id_fkey'`
      );
      expect(userFk.rows[0].ref_table).toBe('users');
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
