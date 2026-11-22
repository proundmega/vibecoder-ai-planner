jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/NotificationService', () => ({
  createForQuestion: jest.fn().mockResolvedValue([]),
  markQuestionRead: jest.fn().mockResolvedValue(1),
}));

jest.mock('../services/HarnessEventService', () => ({
  emit: jest.fn().mockResolvedValue({ event: {}, duplicate: false }),
}));

const TicketQuestionService = require('../services/TicketQuestionService');
const NotificationService = require('../services/NotificationService');
const { pool } = require('../db');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = 7;

function clientWith(responses = []) {
  const client = { query: jest.fn(), release: jest.fn() };
  for (const response of responses) {
    client.query.mockResolvedValueOnce(response);
  }
  client.query.mockResolvedValue({ rows: [] });
  pool.connect.mockResolvedValueOnce(client);
  return client;
}

function runRow(overrides = {}) {
  return {
    id: RUN_ID,
    ticket_id: 42,
    project_id: 5,
    runtime_id: 3,
    status: 'running',
    ...overrides,
  };
}

function questionRow(overrides = {}) {
  return {
    id: QUESTION_ID,
    run_id: RUN_ID,
    ticket_id: 42,
    project_id: 5,
    runtime_id: 3,
    external_id: 'evt_1',
    kind: 'question',
    status: 'pending',
    prompt: 'Which helper should I use?',
    answer: null,
    answered_by: null,
    answered_at: null,
    expires_at: null,
    ...overrides,
  };
}

describe('TicketQuestionService (fg-55)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    NotificationService.createForQuestion.mockResolvedValue([]);
    NotificationService.markQuestionRead.mockResolvedValue(1);
  });

  it('creates a pending question, marks the run waiting and fans out notifications', async () => {
    const question = questionRow();
    const client = clientWith([
      {}, // BEGIN
      { rows: [runRow()] },
      { rows: [] }, // no existing external id
      { rows: [question] },
      { rows: [] }, // waiting update
      {}, // COMMIT
    ]);

    const result = await TicketQuestionService.createForRun({
      runId: RUN_ID,
      runtimeId: 3,
      externalId: 'evt_1',
      kind: 'question',
      prompt: question.prompt,
    });

    expect(result).toEqual(question);
    const waiting = client.query.mock.calls.find(([sql]) => sql.includes('waiting_since = COALESCE'));
    expect(waiting[1]).toEqual([RUN_ID]);
    expect(NotificationService.createForQuestion).toHaveBeenCalledWith(
      question,
      { client }
    );
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  });

  it('deduplicates by run and external id', async () => {
    const existing = questionRow();
    const client = clientWith([
      {}, // BEGIN
      { rows: [runRow()] },
      { rows: [existing] },
      {}, // COMMIT
    ]);

    const result = await TicketQuestionService.createForRun({
      runId: RUN_ID,
      runtimeId: 3,
      externalId: 'evt_1',
      prompt: 'repeated',
    });

    expect(result).toEqual(existing);
    expect(NotificationService.createForQuestion).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO ticket_questions'))).toBe(false);
  });

  it('answers a pending question and clears waiting', async () => {
    const pending = questionRow();
    const answered = questionRow({
      status: 'answered', answer: 'Use the existing helper.', answered_by: 9,
    });
    const client = clientWith([
      {}, // BEGIN
      { rows: [{ ...pending, run_status: 'running' }] },
      { rows: [answered] },
      { rows: [] }, // clear waiting
      {}, // COMMIT
    ]);

    const result = await TicketQuestionService.answer(RUN_ID, QUESTION_ID, {
      answer: 'Use the existing helper.',
      userId: 9,
    });

    expect(result.status).toBe('answered');
    expect(NotificationService.markQuestionRead).toHaveBeenCalledWith(9, QUESTION_ID, { client });
    const clear = client.query.mock.calls.find(([sql]) => sql.includes('waited_ms = waited_ms'));
    expect(clear).toBeTruthy();
  });

  it('rejects a second answer', async () => {
    clientWith([
      {}, // BEGIN
      { rows: [{ ...questionRow({ status: 'answered' }), run_status: 'running' }] },
      {}, // ROLLBACK
    ]);

    await expect(
      TicketQuestionService.answer(RUN_ID, QUESTION_ID, { answer: 'again', userId: 9 })
    ).rejects.toMatchObject({ code: 'QUESTION_ALREADY_ANSWERED', statusCode: 409 });
  });

  it('lists the cross-project inbox only for owners or AGENT_READ members', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await TicketQuestionService.listForUser(9, { status: 'pending' });

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('p.owner_id = $1');
    expect(sql).toContain("perm.code = 'AGENT_READ'");
  });

  it('rejects an answer for a terminal run', async () => {
    clientWith([
      {}, // BEGIN
      { rows: [{ ...questionRow(), run_status: 'succeeded' }] },
      {}, // ROLLBACK
    ]);

    await expect(
      TicketQuestionService.answer(RUN_ID, QUESTION_ID, { answer: 'late', userId: 9 })
    ).rejects.toMatchObject({ code: 'QUESTION_RUN_INACTIVE', statusCode: 409 });
  });

  it('expires a pending question', async () => {
    const pending = questionRow();
    const expired = questionRow({ status: 'expired' });
    const client = clientWith([
      {}, // BEGIN
      { rows: [pending] },
      { rows: [expired] },
      { rows: [] }, // clear waiting
      {}, // COMMIT
    ]);

    const result = await TicketQuestionService.expire(RUN_ID, QUESTION_ID);

    expect(result.status).toBe('expired');
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  });

  it('expires every pending question for a run', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [questionRow(), questionRow({ id: 8 })] })
      .mockResolvedValueOnce({ rows: [] });

    const rows = await TicketQuestionService.expirePendingForRun(RUN_ID, 'run finished');

    expect(rows).toHaveLength(2);
    expect(pool.query.mock.calls[0][0]).toContain("status = 'expired'");
    expect(pool.query.mock.calls[1][0]).toContain('waited_ms = waited_ms');
  });

  it('rolls back the question insert when notification fanout fails', async () => {
    NotificationService.createForQuestion.mockRejectedValueOnce(
      new Error('notification insert failed')
    );
    const client = clientWith([
      {}, // BEGIN
      { rows: [runRow()] },
      { rows: [] },
      { rows: [questionRow()] },
      { rows: [] }, // waiting update
      {}, // ROLLBACK
    ]);

    await expect(
      TicketQuestionService.createForRun({
        runId: RUN_ID,
        runtimeId: 3,
        externalId: 'evt_1',
        prompt: 'Which helper?',
      })
    ).rejects.toThrow('notification insert failed');

    expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });

  it('rejects a question for a run owned by another runtime', async () => {
    clientWith([
      {}, // BEGIN
      { rows: [runRow({ runtime_id: 99 })] },
      {}, // ROLLBACK
    ]);

    await expect(
      TicketQuestionService.createForRun({
        runId: RUN_ID,
        runtimeId: 3,
        prompt: 'Should not persist',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('rejects an oversized prompt', async () => {
    await expect(
      TicketQuestionService.createForRun({
        runId: RUN_ID,
        runtimeId: 3,
        prompt: 'x'.repeat(8193),
      })
    ).rejects.toMatchObject({ code: 'PROMPT_TOO_LONG' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('redacts credential-shaped prompt text before storing it', async () => {
    const client = clientWith([
      {}, // BEGIN
      { rows: [runRow()] },
      { rows: [questionRow({ prompt: 'key [REDACTED]' })] },
      { rows: [] }, // waiting update
      {}, // COMMIT
    ]);

    await TicketQuestionService.createForRun({
      runId: RUN_ID,
      runtimeId: 3,
      prompt: 'use key sk-123456789012345678901234',
    });

    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO ticket_questions'));
    expect(insert[1][6]).toBe('use key [REDACTED]');
    expect(insert[1][6]).not.toContain('sk-123456789012345678901234');
  });
});
