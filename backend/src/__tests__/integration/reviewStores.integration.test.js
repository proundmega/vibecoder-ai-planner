const ReviewAttemptStore = require('../../services/ReviewAttemptStore');
const ReviewFindingStore = require('../../services/ReviewFindingStore');
const { pool: storePool } = require('../../db');

const SHA = 'b'.repeat(40);

async function createTicket() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const user = await global.db.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, 'hash', 'Review Store Test', 'project_admin') RETURNING id`,
    [`review-store-${stamp}@example.test`]
  );
  const project = await global.db.query(
    'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
    [`Review Store ${stamp}`, user.rows[0].id]
  );
  const ticket = await global.db.query(
    `INSERT INTO tickets (project_id, title, description, status, owner_id)
     VALUES ($1, 'Review store ticket', 'Review this PR', 'review', $2) RETURNING id`,
    [project.rows[0].id, user.rows[0].id]
  );
  return {
    userId: user.rows[0].id,
    projectId: project.rows[0].id,
    ticketId: ticket.rows[0].id,
  };
}

async function cleanup({ userId, projectId, ticketId }) {
  await global.db.query('DELETE FROM tickets WHERE id = $1', [ticketId]);
  await global.db.query('DELETE FROM projects WHERE id = $1', [projectId]);
  await global.db.query('DELETE FROM users WHERE id = $1', [userId]);
}

describe('fg-31a review stores (real DB)', () => {
  afterAll(async () => {
    await storePool.end();
  });

  test('migration creates the attempt/finding schema and completed index', async () => {
    const tables = await global.db.query(
      `SELECT to_regclass('public.ticket_review_attempts') AS attempts,
              to_regclass('public.ticket_review_findings') AS findings`
    );
    expect(tables.rows[0].attempts).toBeTruthy();
    expect(tables.rows[0].findings).toBeTruthy();

    const indexes = await global.db.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'ticket_review_attempts'`
    );
    expect(indexes.rows.map((row) => row.indexname))
      .toContain('uq_review_attempt_completed');
  });

  test('migration enforces the store contracts at the database boundary', async () => {
    const fixture = await createTicket();
    try {
      await expect(global.db.query(
        `INSERT INTO ticket_review_attempts (ticket_id, reviewed_sha, status)
         VALUES ($1, 'abc1234', 'started')`,
        [fixture.ticketId]
      )).rejects.toMatchObject({ code: '23514' });

      const attempt = await ReviewAttemptStore.start({
        ticketId: fixture.ticketId,
        reviewedSha: SHA,
      });
      await expect(global.db.query(
        `INSERT INTO ticket_review_findings (attempt_id, finding_key, severity, message)
         VALUES ($1, 'k', 'high', 'not a contract severity')`,
        [attempt.id]
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await cleanup(fixture);
    }
  });

  test('persists an attempt lifecycle and resolves a duplicate completed SHA', async () => {
    const fixture = await createTicket();
    try {
      const first = await ReviewAttemptStore.start({
        ticketId: fixture.ticketId,
        reviewedSha: SHA,
        round: 0,
        provider: 'opencode-go',
        model: 'model/x',
      });
      expect(first.status).toBe('started');
      expect((await ReviewAttemptStore.findById(first.id)).id).toBe(first.id);
      expect(await ReviewAttemptStore.findCompleted(fixture.ticketId, SHA)).toBeNull();

      const completed = await ReviewAttemptStore.complete(first.id, {
        verdict: 'comment',
        verification: { commands: [{ command: 'npm test', exitCode: 0 }] },
        githubReviewId: 555,
        tokensIn: 12,
        tokensOut: 34,
        durationMs: 100,
      });
      expect(completed).toMatchObject({
        status: 'completed',
        verdict: 'comment',
        github_review_id: '555',
        tokens_in: 12,
        tokens_out: 34,
      });
      expect((await ReviewAttemptStore.findCompleted(fixture.ticketId, SHA)).id)
        .toBe(first.id);

      const repeated = await ReviewAttemptStore.complete(first.id, { verdict: 'comment' });
      expect(repeated.id).toBe(first.id);
      expect(repeated.status).toBe('completed');

      const duplicate = await ReviewAttemptStore.start({
        ticketId: fixture.ticketId,
        reviewedSha: SHA,
        round: 0,
      });
      const existing = await ReviewAttemptStore.complete(duplicate.id, {
        verdict: 'comment',
      });
      expect(existing.id).toBe(first.id);
      expect((await ReviewAttemptStore.findById(duplicate.id)).status).toBe('failed');

      const rows = await ReviewAttemptStore.listForTicket(fixture.ticketId);
      expect(rows).toHaveLength(2);
    } finally {
      await cleanup(fixture);
    }
  });

  test('replaces findings, rejects duplicate keys before writing and lists rows', async () => {
    const fixture = await createTicket();
    try {
      const attempt = await ReviewAttemptStore.start({
        ticketId: fixture.ticketId,
        reviewedSha: SHA,
        round: 0,
      });

      const first = await ReviewFindingStore.replaceForAttempt(attempt.id, [
        {
          findingKey: 'src/app.js:10:bug',
          severity: 'critical',
          file: 'src/app.js',
          line: 10,
          message: 'This path drops the error.',
          suggestion: 'Log and rethrow.',
        },
        {
          findingKey: 'src/app.js:20:test',
          severity: 'warning',
          message: 'Missing assertion.',
        },
      ]);
      expect(first).toHaveLength(2);

      await expect(ReviewFindingStore.replaceForAttempt(attempt.id, [
        { findingKey: 'same', severity: 'warning', message: 'one' },
        { findingKey: 'same', severity: 'info', message: 'two' },
      ])).rejects.toThrow('duplicates');

      const rows = await ReviewFindingStore.listForAttempt(attempt.id);
      expect(rows).toHaveLength(2);

      const replaced = await ReviewFindingStore.replaceForAttempt(attempt.id, [{
        findingKey: 'src/app.js:10:bug',
        severity: 'info',
        message: 'Fixed wording.',
      }]);
      expect(replaced).toHaveLength(1);
      expect((await ReviewFindingStore.listForAttempt(attempt.id))[0].severity)
        .toBe('info');
    } finally {
      await cleanup(fixture);
    }
  });

  test('orders findings critical, warning, info', async () => {
    const fixture = await createTicket();
    try {
      const attempt = await ReviewAttemptStore.start({
        ticketId: fixture.ticketId,
        reviewedSha: SHA,
      });
      await ReviewFindingStore.replaceForAttempt(attempt.id, [
        { findingKey: 'info', severity: 'info', message: 'i' },
        { findingKey: 'warning', severity: 'warning', message: 'w' },
        { findingKey: 'critical', severity: 'critical', message: 'c' },
      ]);

      const rows = await ReviewFindingStore.listForAttempt(attempt.id);
      expect(rows.map((row) => row.severity)).toEqual(['critical', 'warning', 'info']);
    } finally {
      await cleanup(fixture);
    }
  });

  test('serialises concurrent finding replacements without a duplicate-key error', async () => {
    const fixture = await createTicket();
    try {
      const attempt = await ReviewAttemptStore.start({
        ticketId: fixture.ticketId,
        reviewedSha: SHA,
      });

      const writers = Array.from({ length: 8 }, (_, writer) => [
        { findingKey: 'shared:a', severity: 'warning', message: `writer ${writer} a` },
        { findingKey: 'shared:b', severity: 'critical', message: `writer ${writer} b` },
        { findingKey: 'shared:c', severity: 'info', message: `writer ${writer} c` },
      ]);
      const results = await Promise.allSettled(
        writers.map((findings) => ReviewFindingStore.replaceForAttempt(attempt.id, findings))
      );

      expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
      const rows = await ReviewFindingStore.listForAttempt(attempt.id);
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.finding_key).sort())
        .toEqual(['shared:a', 'shared:b', 'shared:c']);
    } finally {
      await cleanup(fixture);
    }
  });

  test('rejects findings for a missing attempt', async () => {
    await expect(ReviewFindingStore.replaceForAttempt(
      '33333333-3333-4333-8333-333333333333',
      []
    )).rejects.toMatchObject({ statusCode: 404 });
  });
});
