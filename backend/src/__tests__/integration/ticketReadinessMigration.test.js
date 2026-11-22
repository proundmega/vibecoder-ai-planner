const fs = require('fs');
const path = require('path');

const { SQL_FILES } = require('../../migrations/apply');
const TicketReadinessService = require('../../services/TicketReadinessService');

describe('Migration 061 ticket readiness (real DB)', () => {
  const db = () => global.db;
  let userId;
  let projectId;
  let grandfatheredId;
  let draftId;

  beforeAll(async () => {
    const user = await db().query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, 'hash', 'Readiness Test', 'project_admin') RETURNING id`,
      [`readiness-${Date.now()}@example.test`]
    );
    userId = user.rows[0].id;
    const project = await db().query(
      'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
      [`Readiness ${Date.now()}`, userId]
    );
    projectId = project.rows[0].id;

    const grandfathered = await db().query(
      `INSERT INTO tickets (project_id, title, description, status, owner_id)
       VALUES ($1, 'Already running', 'Existing work', 'in_progress', $2) RETURNING id`,
      [projectId, userId]
    );
    grandfatheredId = grandfathered.rows[0].id;

    const draft = await db().query(
      `INSERT INTO tickets (project_id, title, description, status, owner_id)
       VALUES ($1, 'Still a draft', 'Not started', 'backlog', $2) RETURNING id`,
      [projectId, userId]
    );
    draftId = draft.rows[0].id;

    // Run the exact backfill predicate from the migration.
    await db().query(
      `UPDATE tickets
          SET readiness_grandfathered_at = COALESCE(updated_at, NOW()),
              ready_at = COALESCE(ready_at, updated_at, NOW()),
              plan_approved_at = COALESCE(plan_approved_at, updated_at, NOW()),
              planning_status = CASE
                WHEN planning_status IS NULL OR planning_status <> 'completed' THEN 'completed'
                ELSE planning_status
              END
        WHERE status IN ('in_progress', 'review', 'done')
          AND readiness_grandfathered_at IS NULL`
    );
  });

  afterAll(async () => {
    if (projectId) {
      await db().query('DELETE FROM tickets WHERE project_id = $1', [projectId]);
      await db().query('DELETE FROM projects WHERE id = $1', [projectId]);
    }
    if (userId) await db().query('DELETE FROM users WHERE id = $1', [userId]);
  });

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

  test('grandfathers in-progress/review/done and leaves drafts alone', async () => {
    const grandfathered = await db().query(
      `SELECT readiness_grandfathered_at, ready_at, plan_approved_at, planning_status
         FROM tickets WHERE id = $1`,
      [grandfatheredId]
    );
    expect(grandfathered.rows[0].readiness_grandfathered_at).toBeTruthy();
    expect(grandfathered.rows[0].ready_at).toBeTruthy();
    expect(grandfathered.rows[0].plan_approved_at).toBeTruthy();
    expect(grandfathered.rows[0].planning_status).toBe('completed');

    const draft = await db().query(
      `SELECT readiness_grandfathered_at, ready_at, plan_approved_at
         FROM tickets WHERE id = $1`,
      [draftId]
    );
    expect(draft.rows[0].readiness_grandfathered_at).toBeNull();
    expect(draft.rows[0].ready_at).toBeNull();
    expect(draft.rows[0].plan_approved_at).toBeNull();
  });

  test('a grandfathered ticket skips the execution gate even in enforce mode', async () => {
    const previous = process.env.READINESS_GATE_MODE;
    process.env.READINESS_GATE_MODE = 'enforce';
    try {
      const result = await TicketReadinessService.assertReadyForExecution(grandfatheredId, {
        source: 'pickup',
        toStatus: 'in_progress',
      });
      expect(result).toMatchObject({ ready: true, skipped: true, grandfathered: true });
    } finally {
      if (previous === undefined) delete process.env.READINESS_GATE_MODE;
      else process.env.READINESS_GATE_MODE = previous;
    }
  });

  test('acceptance criteria and the append-only event table accept rows', async () => {
    const criterion = await db().query(
      `INSERT INTO ticket_acceptance_criteria (ticket_id, position, text, created_by)
       VALUES ($1, 0, 'The gate returns 409', $2) RETURNING id`,
      [draftId, userId]
    );
    expect(criterion.rows[0].id).toBeTruthy();

    const event = await db().query(
      `INSERT INTO ticket_readiness_events
         (ticket_id, action, attempt_id, actor_type, actor_user_id, actor_role, before_state, after_state)
       VALUES ($1, 'blocked', gen_random_uuid(), 'user', $2, 'project_admin', '{}'::jsonb, '{}'::jsonb)
       RETURNING id`,
      [draftId, userId]
    );
    expect(event.rows[0].id).toBeTruthy();
  });
});
