jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  transaction: jest.fn(),
}));

const ReviewAttemptStore = require('../services/ReviewAttemptStore');
const { pool } = require('../db');

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
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO ticket_review_attempts');
    expect(params).toEqual([TICKET_ID, SHA, 2, 'opencode-go', 'model/x']);
  });

  it('rejects invalid start inputs', async () => {
    await expect(ReviewAttemptStore.start({ ticketId: 0, reviewedSha: SHA }))
      .rejects.toThrow('ticketId must be a positive integer');
    await expect(ReviewAttemptStore.start({ ticketId: 1, reviewedSha: 'not-a-sha' }))
      .rejects.toThrow('reviewedSha must be a hexadecimal SHA');
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
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'completed'");
    expect(params).toEqual([ATTEMPT_ID, 'approve', verification, 9001, 10, 20, 300]);
  });

  it('rejects an invalid verdict and negative usage', async () => {
    await expect(ReviewAttemptStore.complete(ATTEMPT_ID, { verdict: 'merge' }))
      .rejects.toThrow('verdict must be one of');
    await expect(ReviewAttemptStore.complete(ATTEMPT_ID, {
      verdict: 'comment', tokensIn: -1,
    })).rejects.toThrow('tokensIn must be a non-negative integer');
  });

  it('marks an attempt failed with a reason', async () => {
    pool.query.mockResolvedValueOnce({ rows: [attempt({ status: 'failed' })] });

    await ReviewAttemptStore.fail(ATTEMPT_ID, 'provider timeout');

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(params).toEqual([ATTEMPT_ID, 'provider timeout']);
  });

  it('finds only a completed review for the ticket and SHA', async () => {
    pool.query.mockResolvedValueOnce({ rows: [attempt({ status: 'completed' })] });

    const row = await ReviewAttemptStore.findCompleted(TICKET_ID, SHA);

    expect(row.status).toBe('completed');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'completed'");
    expect(params).toEqual([TICKET_ID, SHA]);
  });

  it('lists attempts with validated paging and status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [attempt()] });

    await ReviewAttemptStore.listForTicket(TICKET_ID, {
      status: 'started', limit: 5, offset: 10,
    });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('FROM ticket_review_attempts');
    expect(params).toEqual([TICKET_ID, 'started', 5, 10]);
    await expect(ReviewAttemptStore.listForTicket(TICKET_ID, { limit: 0 }))
      .rejects.toThrow('limit must be between');
    await expect(ReviewAttemptStore.listForTicket(TICKET_ID, { status: 'unknown' }))
      .rejects.toThrow('status must be one of');
  });
});
