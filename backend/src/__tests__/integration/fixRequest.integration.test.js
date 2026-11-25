const FixRequestService = require('../../services/FixRequestService');
const { pool: storePool } = require('../../db');

const SHA = 'c'.repeat(40);

async function createFixture({ branch = 'feat/fix-review', status = 'review', phase = 'review' } = {}) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const user = await global.db.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, 'hash', 'Fix Request Test', 'project_admin') RETURNING id`,
    [`fix-request-${stamp}@example.test`]
  );
  const project = await global.db.query(
    `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
    [`Fix Request ${stamp}`, user.rows[0].id]
  );
  const ticket = await global.db.query(
    `INSERT INTO tickets
       (project_id, title, description, status, phase, branch_name, owner_id)
     VALUES ($1, 'Fix request ticket', 'Review this PR', $2, $3, $4, $5)
     RETURNING id`,
    [project.rows[0].id, status, phase, branch, user.rows[0].id]
  );
  return {
    userId: user.rows[0].id,
    projectId: project.rows[0].id,
    ticketId: ticket.rows[0].id,
  };
}

async function createAttempt(ticketId, overrides = {}) {
  const values = {
    status: 'completed',
    verdict: 'request_changes',
    reviewedSha: SHA,
    round: 1,
    ...overrides,
  };
  const { rows } = await global.db.query(
    `INSERT INTO ticket_review_attempts
       (ticket_id, reviewed_sha, status, round, verdict, completed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [ticketId, values.reviewedSha, values.status, values.round, values.verdict]
  );
  return rows[0];
}

async function cleanup(fixture) {
  await global.db.query('DELETE FROM tickets WHERE id = $1', [fixture.ticketId]);
  await global.db.query('DELETE FROM projects WHERE id = $1', [fixture.projectId]);
  await global.db.query('DELETE FROM users WHERE id = $1', [fixture.userId]);
}

describe('fg-32a fix requests (real DB)', () => {
  afterAll(async () => {
    await storePool.end();
  });

  test('migration creates the fix-request schema and ticket cache fields', async () => {
    const tables = await global.db.query(
      `SELECT to_regclass('public.ticket_fix_requests') AS requests`
    );
    expect(tables.rows[0].requests).toBeTruthy();

    const indexes = await global.db.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'ticket_fix_requests'`
    );
    const names = indexes.rows.map((row) => row.indexname);
    expect(names).toContain('uq_fix_request_active');
    expect(names).toContain('idx_fix_requests_queue');

    const columns = await global.db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tickets'
          AND column_name IN ('review_state', 'review_round', 'reviewed_sha', 'fix_branch')`
    );
    expect(columns.rows).toHaveLength(4);

    const projectColumn = await global.db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'fix_loop_mode'`
    );
    expect(projectColumn.rows).toHaveLength(1);
  });

  test('creates one request and moves review -> in_progress', async () => {
    const fixture = await createFixture();
    try {
      const attempt = await createAttempt(fixture.ticketId);
      const first = await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: attempt.id });

      expect(first.created).toBe(true);
      expect(first.request).toMatchObject({
        ticket_id: fixture.ticketId,
        attempt_id: attempt.id,
        source: 'reviewer',
        branch: 'feat/fix-review',
        reviewed_sha: SHA,
        state: 'queued',
        feedback: null,
      });

      const ticket = await global.db.query(
        'SELECT * FROM tickets WHERE id = $1', [fixture.ticketId]);
      expect(ticket.rows[0]).toMatchObject({
        status: 'in_progress',
        phase: 'in_progress',
        review_state: 'changes_requested',
        review_round: 1,
        reviewed_sha: SHA,
        fix_branch: 'feat/fix-review',
      });

      const phases = await global.db.query(
        `SELECT from_phase, to_phase, actor_type, metadata
           FROM ticket_phases WHERE ticket_id = $1 ORDER BY created_at`,
        [fixture.ticketId]
      );
      expect(phases.rows).toHaveLength(1);
      expect(phases.rows[0]).toMatchObject({
        from_phase: 'review',
        to_phase: 'in_progress',
        actor_type: 'agent',
      });

      const retry = await FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: attempt.id });
      expect(retry.created).toBe(false);
      expect(retry.request.id).toBe(first.request.id);

      const count = await global.db.query(
        'SELECT COUNT(*)::int AS count FROM ticket_fix_requests WHERE ticket_id = $1',
        [fixture.ticketId]
      );
      expect(count.rows[0].count).toBe(1);
    } finally {
      await cleanup(fixture);
    }
  });

  test('rejects incomplete or non-request-changes attempts and a missing branch', async () => {
    const fixture = await createFixture();
    try {
      const started = await createAttempt(fixture.ticketId, { status: 'started' });
      await expect(FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: started.id }))
        .rejects.toThrow('Review attempt is not completed');

      const comment = await createAttempt(fixture.ticketId, {
        verdict: 'comment', reviewedSha: 'd'.repeat(40),
      });
      await expect(FixRequestService.createOrEnsure(
        fixture.ticketId, { attemptId: comment.id }))
        .rejects.toThrow('Review attempt did not request changes');

      const noBranch = await createFixture({ branch: null });
      try {
        const attempt = await createAttempt(noBranch.ticketId);
        await expect(FixRequestService.createOrEnsure(
          noBranch.ticketId, { attemptId: attempt.id }))
          .rejects.toThrow('Ticket branch is unavailable');
      } finally {
        await cleanup(noBranch);
      }
    } finally {
      await cleanup(fixture);
    }
  });

  test('supports a manual request from the latest completed review', async () => {
    const fixture = await createFixture();
    try {
      await createAttempt(fixture.ticketId, { round: 2 });
      const result = await FixRequestService.createOrEnsure(
        fixture.ticketId, { feedback: 'Please fix the filter' });

      expect(result.created).toBe(true);
      expect(result.request).toMatchObject({
        attempt_id: null,
        source: 'human',
        feedback: 'Please fix the filter',
        reviewed_sha: SHA,
      });

      const ticket = await global.db.query(
        'SELECT review_round, review_state FROM tickets WHERE id = $1',
        [fixture.ticketId]
      );
      expect(ticket.rows[0]).toMatchObject({
        review_round: 2,
        review_state: 'changes_requested',
      });
    } finally {
      await cleanup(fixture);
    }
  });
});
