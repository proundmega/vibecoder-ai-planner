const fs = require('fs');
const path = require('path');

const { SQL_FILES } = require('../../migrations/apply');
const { runMigrationFile } = require('./migrationSupport');
const TicketReadinessService = require('../../services/TicketReadinessService');

const MIGRATION = path.join(__dirname, '../../migrations/061_ticket_readiness.sql');

function clientPool(client) {
  return { query: (...args) => client.query(...args) };
}

async function createTicketFixtures(client, { status = 'backlog' } = {}) {
  const user = await client.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, 'hash', 'Readiness Test', 'project_admin') RETURNING id`,
    [`readiness-${Date.now()}-${Math.random()}@example.test`]
  );
  const userId = user.rows[0].id;
  const project = await client.query(
    'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
    [`Readiness ${Date.now()}-${Math.random()}`, userId]
  );
  const projectId = project.rows[0].id;
  const ticket = await client.query(
    `INSERT INTO tickets (project_id, title, description, status, owner_id)
     VALUES ($1, 'Readiness ticket', 'Existing work', $2, $3) RETURNING id`,
    [projectId, status, userId]
  );
  return { userId, projectId, ticketId: ticket.rows[0].id };
}

describe('Migration 061 ticket readiness (real DB)', () => {
  test('registers 061 after 060', () => {
    const names = SQL_FILES.map(file => path.basename(file));
    expect(names.indexOf('061_ticket_readiness.sql')).toBeGreaterThan(
      names.indexOf('060_ticket_questions_notifications.sql')
    );
  });

  test('ships a rollback that removes the tables, columns and permissions', () => {
    const rollback = fs.readFileSync(
      path.join(__dirname, '../../migrations/061_ticket_readiness_rollback.sql'),
      'utf8'
    );
    expect(rollback).toContain('DROP TABLE IF EXISTS ticket_readiness_events');
    expect(rollback).toContain('DROP TABLE IF EXISTS ticket_acceptance_criteria');
    expect(rollback).toContain('DROP COLUMN IF EXISTS plan_approved_at');
    expect(rollback).toContain('TICKET_READINESS_APPROVE');
  });

  test('the real migration grandfathers in-progress/review/done and leaves drafts alone', async () => {
    await global.withTransaction(async (client) => {
      const running = await createTicketFixtures(client, { status: 'in_progress' });
      const draft = await createTicketFixtures(client, { status: 'backlog' });

      await runMigrationFile(MIGRATION, clientPool(client));

      const grandfathered = await client.query(
        `SELECT readiness_grandfathered_at, ready_at, plan_approved_at, planning_status
           FROM tickets WHERE id = $1`,
        [running.ticketId]
      );
      expect(grandfathered.rows[0].readiness_grandfathered_at).toBeTruthy();
      expect(grandfathered.rows[0].ready_at).toBeTruthy();
      expect(grandfathered.rows[0].plan_approved_at).toBeTruthy();
      expect(grandfathered.rows[0].planning_status).toBe('completed');

      const untouched = await client.query(
        `SELECT readiness_grandfathered_at, ready_at, plan_approved_at
           FROM tickets WHERE id = $1`,
        [draft.ticketId]
      );
      expect(untouched.rows[0].readiness_grandfathered_at).toBeNull();
      expect(untouched.rows[0].ready_at).toBeNull();
      expect(untouched.rows[0].plan_approved_at).toBeNull();
    });
  });

  test('a grandfathered ticket skips the execution gate even in enforce mode', async () => {
    const db = global.db;
    const { userId, projectId, ticketId } = await createTicketFixtures(db, {
      status: 'in_progress',
    });
    await db.query(
      `UPDATE tickets
          SET readiness_grandfathered_at = NOW(), ready_at = NOW(),
              plan_approved_at = NOW(), planning_status = 'completed'
        WHERE id = $1`,
      [ticketId]
    );

    const previous = process.env.READINESS_GATE_MODE;
    process.env.READINESS_GATE_MODE = 'enforce';
    try {
      const result = await TicketReadinessService.assertReadyForExecution(ticketId, {
        source: 'pickup',
        toStatus: 'in_progress',
      });
      expect(result).toMatchObject({ ready: true, skipped: true, grandfathered: true });
    } finally {
      if (previous === undefined) delete process.env.READINESS_GATE_MODE;
      else process.env.READINESS_GATE_MODE = previous;
      await db.query('DELETE FROM tickets WHERE project_id = $1', [projectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });

  test('acceptance criteria and the append-only event table accept rows', async () => {
    await global.withTransaction(async (client) => {
      const { userId, ticketId } = await createTicketFixtures(client);

      const criterion = await client.query(
        `INSERT INTO ticket_acceptance_criteria (ticket_id, position, text, created_by)
         VALUES ($1, 0, 'The gate returns 409', $2) RETURNING id`,
        [ticketId, userId]
      );
      expect(criterion.rows[0].id).toBeTruthy();

      const event = await client.query(
        `INSERT INTO ticket_readiness_events
           (ticket_id, action, attempt_id, actor_type, actor_user_id, actor_role, before_state, after_state)
         VALUES ($1, 'blocked', gen_random_uuid(), 'user', $2, 'project_admin', '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [ticketId, userId]
      );
      expect(event.rows[0].id).toBeTruthy();
    });
  });
});
