jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  transaction: jest.fn(),
}));

const ReviewFindingStore = require('../services/ReviewFindingStore');
const { pool, transaction } = require('../db');

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';

function finding(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    attempt_id: ATTEMPT_ID,
    finding_key: 'src/app.js:10:bug',
    severity: 'high',
    file: 'src/app.js',
    line: 10,
    message: 'This path drops the error.',
    suggestion: 'Log and rethrow.',
    resolved_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

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
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [expected] });
    transaction.mockImplementationOnce(async (fn) => fn(client));

    const rows = await ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: ' src/app.js:10:bug ',
      severity: ' high ',
      file: ' src/app.js ',
      line: '10',
      message: ' This path drops the error. ',
      suggestion: ' Log and rethrow. ',
    }]);

    expect(rows).toEqual([expected]);
    expect(client.query.mock.calls[0]).toEqual([
      'DELETE FROM ticket_review_findings WHERE attempt_id = $1',
      [ATTEMPT_ID],
    ]);
    const [sql, params] = client.query.mock.calls[1];
    expect(sql).toContain('INSERT INTO ticket_review_findings');
    expect(params).toEqual([
      ATTEMPT_ID,
      'src/app.js:10:bug',
      'high',
      'src/app.js',
      10,
      'This path drops the error.',
      'Log and rethrow.',
    ]);
  });

  it('allows an empty finding set to clear the attempt', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    transaction.mockImplementationOnce(async (fn) => fn(client));

    await ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, []);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      'DELETE FROM ticket_review_findings WHERE attempt_id = $1',
      [ATTEMPT_ID]
    );
  });

  it('rejects malformed findings before opening a transaction', async () => {
    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: '', severity: 'high', message: 'x',
    }])).rejects.toThrow('findingKey is required');
    await expect(ReviewFindingStore.replaceForAttempt(ATTEMPT_ID, [{
      findingKey: 'k', severity: 'high', message: 'x', line: 0,
    }])).rejects.toThrow('line must be a positive integer');
    await expect(ReviewFindingStore.replaceForAttempt('bad-id', []))
      .rejects.toThrow('attemptId must be a UUID');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lists findings for an attempt', async () => {
    const expected = finding();
    pool.query.mockResolvedValueOnce({ rows: [expected] });

    const rows = await ReviewFindingStore.listForAttempt(ATTEMPT_ID);

    expect(rows).toEqual([expected]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM ticket_review_findings'),
      [ATTEMPT_ID]
    );
  });
});
