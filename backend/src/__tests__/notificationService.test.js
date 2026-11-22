jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const NotificationService = require('../services/NotificationService');
const { pool } = require('../db');

function clientWith(responses = []) {
  const client = { query: jest.fn(), release: jest.fn() };
  for (const response of responses) {
    client.query.mockResolvedValueOnce(response);
  }
  client.query.mockResolvedValue({ rows: [] });
  pool.connect.mockResolvedValueOnce(client);
  return client;
}

const QUESTION = {
  id: 7,
  run_id: '11111111-1111-4111-8111-111111111111',
  ticket_id: 42,
  project_id: 5,
  kind: 'question',
  prompt: 'Which helper should I use?',
};

describe('NotificationService (fg-55)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('fans out one question notification per recipient', async () => {
    const client = clientWith([
      { rows: [{ id: 1 }] }, // recipient 1
      { rows: [{ id: 2 }] }, // recipient 2
    ]);

    const rows = await NotificationService.createForQuestion(QUESTION, {
      recipients: [1, 2],
      client,
    });

    expect(rows).toHaveLength(2);
    const inserts = client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO notifications'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1][0]).toBe(1);
    expect(inserts[1][1][0]).toBe(2);
    const payload = JSON.parse(inserts[0][1][6]);
    expect(payload.preview).toContain('Which helper');
  });

  it('lists notifications for the owning user only', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const rows = await NotificationService.listForUser(9, { unread: true, limit: 10 });

    expect(rows).toEqual([{ id: 1 }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('WHERE user_id = $1');
    expect(sql).toContain('read_at IS NULL');
    expect(params).toEqual([9, 10, 0]);
  });

  it('counts unread notifications', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ count: 3 }] });

    await expect(NotificationService.unreadCount(9)).resolves.toBe(3);
  });

  it('marks one notification read', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 4, read_at: 'now' }] });

    const row = await NotificationService.markRead(9, 4);

    expect(row.id).toBe(4);
    expect(pool.query.mock.calls[0][1]).toEqual([4, 9]);
  });

  it('marks every notification read', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });

    await expect(NotificationService.markAllRead(9)).resolves.toBe(2);
  });

  it('marks the question notification read for an answering user', async () => {
    const client = clientWith([{ rows: [{ id: 1 }] }]);

    await expect(
      NotificationService.markQuestionRead(9, 7, { client })
    ).resolves.toBe(1);
    expect(client.query.mock.calls[0][1]).toEqual([9, 7]);
  });

  it('propagates a notification failure to the caller transaction', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    client.query.mockRejectedValueOnce(new Error('notification insert failed'));

    await expect(
      NotificationService.createForQuestion(QUESTION, { recipients: [1], client })
    ).rejects.toThrow('notification insert failed');
    // The caller owns the transaction; this service must not commit or release.
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).not.toHaveBeenCalled();
  });

  it('creates run finish notifications with a derived type', async () => {
    const client = clientWith([
      { rows: [{ user_id: 1 }, { user_id: 1 }, { user_id: 2 }] }, // recipients
      { rows: [{ id: 1 }] }, // insert
      { rows: [{ id: 2 }] }, // insert
    ]);

    const rows = await NotificationService.createForRunFinish(
      {
        id: QUESTION.run_id,
        project_id: 5,
        ticket_id: 42,
        status: 'budget_exceeded',
        error: 'cost budget exhausted',
        pr_url: null,
      },
      { client }
    );

    expect(rows).toHaveLength(2);
    const inserts = client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO notifications'));
    expect(inserts[0][1][5]).toBe('budget_exceeded');
  });
});
