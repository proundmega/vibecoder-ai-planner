jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  transaction: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const ReviewAttemptStore = require('../services/ReviewAttemptStore');
const ReviewFindingStore = require('../services/ReviewFindingStore');
const { pool, transaction } = require('../db');

const migrations = path.join(__dirname, '..', 'migrations');
const applySource = fs.readFileSync(path.join(migrations, 'apply.js'), 'utf8');
const sql = fs.readFileSync(path.join(migrations, '062_ticket_review_attempts.sql'), 'utf8');
const rollback = fs.readFileSync(
  path.join(migrations, '062_ticket_review_attempts_rollback.sql'),
  'utf8'
);

const TICKET_ID = 42;
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(40);

function attempt(overrides = {}) {
  return {
    id: ATTEMPT_ID,
    ticket_id: TICKET_ID,
    reviewed_sha: SHA,
    status: 'started',
    round: 0,
    verdict: null,
    verification: null,
    github_review_id: null,
    provider: null,
    model: null,
    tokens_in: null,
    tokens_out: null,
    duration_ms: null,
    failure_reason: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    attempt_id: ATTEMPT_ID,
    finding_key: 'src/app.js:10:bug',
    severity: 'warning',
    file: 'src/app.js',
    line: 10,
    message: 'This path drops the error.',
    suggestion: 'Log and rethrow.',
    resolved_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('review attempt migration (fg-31a FR7/FR8)', () => {
  it('registers the additive migration after readiness', () => {
    const readiness = applySource.indexOf('061_ticket_readiness.sql');
    const review = applySource.indexOf('062_ticket_review_attempts.sql');
    expect(readiness).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(readiness);
  });

  it('creates attempts and findings with the idempotency guards', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ticket_review_attempts');
    expect(sql).toContain("status IN ('started', 'completed', 'failed')");
    expect(sql).toContain("verdict IN ('approve', 'request_changes', 'comment')");
    expect(sql).toContain("reviewed_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'");
    expect(sql).toContain('uq_review_attempt_completed');
    expect(sql).toContain("WHERE status = 'completed'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ticket_review_findings');
    expect(sql).toContain("severity IN ('critical', 'warning', 'info')");
    expect(sql).toContain('UNIQUE (attempt_id, finding_key)');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('drops findings before attempts on rollback', () => {
    const findings = rollback.indexOf('DROP TABLE IF EXISTS ticket_review_findings');
    const attempts = rollback.indexOf('DROP TABLE IF EXISTS ticket_review_attempts');
    expect(findings).toBeGreaterThan(-1);
    expect(attempts).toBeGreaterThan(findings);
  });
});

describe('ReviewAttemptStore (fg-31a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('starts an attempt with a normalised SHA and round', async () => {
    const expected = attempt();
    pool.query.mockResolvedValueOnce({ rows: [expected] });

    const row = await ReviewAttemptStore.start({
      ticketId: TICKET_ID,
      reviewedSha: SHA.toUpperCase(),
      round: 2,
      provider: 'opencode-go',
      model: 'model/x',
    });

    expect(row).toEqual(expected);
    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain('INSERT INTO ticket_review_attempts');
    expect(params).toEqual([TICKET_ID, SHA, 2, 'opencode-go', 'model/x']);
  });

  it('rejects invalid start inputs, including short SHAs', async () => {
    await expect(ReviewAttemptStore.start({ ticketId: 0, reviewedSha: SHA }))
      .rejects.toThrow('ticketId must be a positive integer');
    await expect(ReviewAttemptStore.start({ ticketId: 1, reviewedSha: 'abc1234' }))
      .rejects.toThrow('reviewedSha must be a 40- or 64-character hexadecimal SHA');
    await expect(ReviewAttemptStore.start({ ticketId: 1, reviewedSha: SHA, round: -1 }))
      .rejects.toThrow('round must be a non-negative integer');
  });

  it('completes an attempt with supervisor verification and usage', async () => {
    const completed = attempt({ status: 'completed', verdict: 'approve' });
    pool.query.mockResolvedValueOnce({ rows: [completed] });
    const verification = { commands: [{ command: 'npm test', exitCode: 0 }] };

    const row = await ReviewAttemptStore.complete(ATTEMPT_ID, {
      verdict: 'approve',
      verification,
      githubReviewId: 9001,
      tokensIn: 10,
      tokensOut: 20,
      durationMs: 300,
    });

    expect(row).toEqual(completed);
    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain("status = 'completed'");
    expect(query).toContain('COALESCE($4, github_review_id)');
    expect(params).toEqual([ATTEMPT_ID, 'approve', verification, 9001, 10, 20, 300]);
  });

  it('returns the existing attempt when it was already completed', async () => {
    const completed = attempt({ status: 'completed', verdict: 'approve' });
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // UPDATE matched no row
      .mockResolvedValueOnce({ rows: [completed] }); // findById

    const row = await ReviewAttemptStore.complete(ATTEMPT_ID, { verdict: 'approve' });

    expect(row).toEqual(completed);
  });

  it('returns the existing completed attempt on a duplicate-key race', async () => {
    const completed = attempt({ status: 'completed', verdict: 'comment' });
    pool.query
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
      .mockResolvedValueOnce({ rows: [attempt()] }) // findById
      .mockResolvedValueOnce({ rows: [attempt({ status: 'failed' })] }) // fail
      .mockResolvedValueOnce({ rows: [completed] }); // findCompleted

    const row = await ReviewAttemptStore.complete(ATTEMPT_ID, { verdict: 'comment' });

    expect(row).toEqual(completed);
    expect(pool.query.mock.calls[2][0]).toContain("status = 'failed'");
  });

  it('rejects an invalid verdict and negative usage', async () => {
    await expect(ReviewAttemptStore.complete(ATTEMPT_ID, { verdict: 'merge' }))
      .rejects.toThrow('verdict must be one of');
    await expect(ReviewAttemptStore.complete(ATTEMPT_ID, {
      verdict: 'comment', tokensIn: -1,
    })).rejects.toThrow('tokensIn must be a non-negative integer');
  });

  it('marks an attempt failed with a required reason', async () => {
    pool.query.mockResolvedValueOnce({ rows: [attempt({ status: 'failed' })] });

    await ReviewAttemptStore.fail(ATTEMPT_ID, 'provider timeout');

    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain("status = 'failed'");
    expect(params).toEqual([ATTEMPT_ID, 'provider timeout']);
    await expect(ReviewAttemptStore.fail(ATTEMPT_ID)).rejects.toThrow('reason is required');
  });

  it('finds an attempt by id', async () => {
    const expected = attempt();
    pool.query.mockResolvedValueOnce({ rows: [expected] });

    const row = await ReviewAttemptStore.findById(ATTEMPT_ID);

    expect(row).toEqual(expected);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT * FROM ticket_review_attempts WHERE id = $1',
      [ATTEMPT_ID]
    );
  });

  it('finds only a completed review for the ticket and SHA', async () => {
    pool.query.mockResolvedValueOnce({ rows: [attempt({ status: 'completed' })] });

    const row = await ReviewAttemptStore.findCompleted(TICKET_ID, SHA);

    expect(row.status).toBe('completed');
    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain("status = 'completed'");
    expect(params).toEqual([TICKET_ID, SHA]);
  });

  it('lists attempts with validated paging and status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [attempt()] });

    await ReviewAttemptStore.listForTicket(TICKET_ID, {
      status: 'started', limit: 5, offset: 10,
    });

    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain('FROM ticket_review_attempts');
    expect(params).toEqual([TICKET_ID, 'started', 5, 10]);
    await expect(ReviewAttemptStore.listForTicket(TICKET_ID, { limit: 0 }))
      .rejects.toThrow('limit must be between');
    await expect(ReviewAttemptStore.listForTicket(TICKET_ID, { status: 'unknown' }))
      .rejects.toThrow('status must be one of');
  });
});

describe('ReviewFindingStore (fg-31a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    transaction.mockImplementation(async (fn) => fn({ query: jest.fn() }));
  });

  it('replaces findings atomically and returns the inserted rows', async () => {
    const expected = finding();
    const client = { query: jest.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [{ id: ATTEMPT_ID }] }) // FOR UPDATE lock
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [expected] });
    transaction.mockImplementationOnce(async (fn) => fn(client));

    const rows = await ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: ' src/app.js:10:bug ',
      severity: ' warning ',
      file: ' src/app.js ',
      line: '10',
      message: ' This path drops the error. ',
      suggestion: ' Log and rethrow. ',
    }]);

    expect(rows).toEqual([expected]);
    expect(client.query.mock.calls[0]).toEqual([
      'SELECT id FROM ticket_review_attempts WHERE id = $1 FOR UPDATE',
      [ATTEMPT_ID],
    ]);
    expect(client.query.mock.calls[1]).toEqual([
      'DELETE FROM ticket_review_findings WHERE attempt_id = $1',
      [ATTEMPT_ID],
    ]);
    const [query, params] = client.query.mock.calls[2];
    expect(query).toContain('INSERT INTO ticket_review_findings');
    expect(params).toEqual([
      ATTEMPT_ID,
      'src/app.js:10:bug',
      'warning',
      'src/app.js',
      10,
      'This path drops the error.',
      'Log and rethrow.',
    ]);
  });

  it('allows an empty finding set to clear the attempt', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: ATTEMPT_ID }] })
        .mockResolvedValue({ rows: [] }),
    };
    transaction.mockImplementationOnce(async (fn) => fn(client));

    await ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, []);

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM ticket_review_findings WHERE attempt_id = $1',
      [ATTEMPT_ID]
    );
  });

  it('rejects a missing attempt instead of returning an empty list', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [] }), // lock matched nothing
    };
    transaction.mockImplementationOnce(async (fn) => fn(client));

    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, []))
      .rejects.toThrow(`Review attempt ${ATTEMPT_ID} was not found`);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed and duplicate findings before opening a transaction', async () => {
    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: '', severity: 'warning', message: 'x',
    }])).rejects.toThrow('findingKey is required');
    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: 'k', severity: 'high', message: 'x',
    }])).rejects.toThrow('severity must be one of');
    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: 'k', severity: 'warning', message: 'x', line: 0,
    }])).rejects.toThrow('line must be a positive integer');
    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [
      { findingKey: 'same', severity: 'warning', message: 'one' },
      { findingKey: 'same', severity: 'info', message: 'two' },
    ])).rejects.toThrow('duplicates');
    await expect(ReviewFindingStore.replaceForAttempt('bad-id', []))
      .rejects.toThrow('attemptId must be a UUID');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lists findings for an attempt', async () => {
    const expected = finding();
    pool.query.mockResolvedValueOnce({ rows: [expected] });

    const rows = await ReviewFindingStore.listForAttempt(ATTEMPT_ID);

    expect(rows).toEqual([expected]);
    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain('CASE severity');
    expect(query).toContain('WHEN \'critical\' THEN 0');
    expect(params).toEqual([ATTEMPT_ID]);
  });
});
