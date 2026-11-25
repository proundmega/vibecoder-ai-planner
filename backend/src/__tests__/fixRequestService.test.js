jest.mock('../db', () => ({
  transaction: jest.fn(),
}));

const { transaction } = require('../db');
const { FixRequestService } = require('../services/FixRequestService');

const TICKET_ID = 42;
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(40);
const BRANCH = 'feat/fix-review';

function ticket(overrides = {}) {
  return {
    id: TICKET_ID,
    status: 'review',
    phase: 'review',
    branch_name: BRANCH,
    reviewed_sha: null,
    review_round: 0,
    ...overrides,
  };
}

function attempt(overrides = {}) {
  return {
    id: ATTEMPT_ID,
    ticket_id: TICKET_ID,
    status: 'completed',
    verdict: 'request_changes',
    reviewed_sha: SHA,
    round: 1,
    ...overrides,
  };
}

function fixRequest(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    ticket_id: TICKET_ID,
    attempt_id: ATTEMPT_ID,
    source: 'reviewer',
    branch: BRANCH,
    reviewed_sha: SHA,
    state: 'queued',
    feedback: null,
    ...overrides,
  };
}

function fakeClient(overrides = {}) {
  const state = {
    ticket: ticket(),
    existingAttemptRequest: [],
    attempt: attempt(),
    latestAttempt: null,
    active: [],
    inserted: fixRequest(),
    queries: [],
    ...overrides,
  };
  const client = {
    query: jest.fn(async (sql, params) => {
      state.queries.push({ sql, params });
      if (sql.includes('FROM tickets')) {
        return { rows: state.ticket ? [state.ticket] : [] };
      }
      if (sql.includes('FROM ticket_fix_requests WHERE attempt_id')) {
        return {
          rows: state.existingAttemptRequest.filter(
            (row) => Number(row.ticket_id) === Number(params[1])),
        };
      }
      if (sql.includes('FROM ticket_review_attempts WHERE id =')) {
        return { rows: state.attempt ? [state.attempt] : [] };
      }
      if (sql.includes('FROM ticket_review_attempts')) {
        return { rows: state.latestAttempt ? [state.latestAttempt] : [] };
      }
      if (sql.includes('FROM ticket_fix_requests') && sql.includes('state IN')) {
        return { rows: state.active };
      }
      if (sql.includes('UPDATE tickets')) {
        return { rows: [state.ticket] };
      }
      if (sql.includes('INSERT INTO ticket_phases')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO ticket_fix_requests')) {
        return { rows: [state.inserted] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return { client, state };
}

describe('FixRequestService (fg-32a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a reviewer request and moves review -> in_progress atomically', async () => {
    const { client, state } = fakeClient();
    const service = new FixRequestService();

    const result = await service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID });

    expect(result.created).toBe(true);
    expect(result.request).toEqual(fixRequest());
    const update = state.queries.find((query) => query.sql.includes('UPDATE tickets'));
    expect(update.params).toEqual([TICKET_ID, 1, SHA, BRANCH]);
    const phase = state.queries.find((query) => query.sql.includes('INSERT INTO ticket_phases'));
    expect(phase.params.slice(0, 3)).toEqual([TICKET_ID, 'review', 'agent']);
    const insert = state.queries.find((query) =>
      query.sql.includes('INSERT INTO ticket_fix_requests'));
    expect(insert.params).toEqual([
      TICKET_ID, ATTEMPT_ID, 'reviewer', BRANCH, SHA, null,
    ]);
  });

  it('does not return another ticket request for a foreign attempt', async () => {
    const foreign = fixRequest({ ticket_id: 99 });
    const { client } = fakeClient({
      existingAttemptRequest: [foreign],
      attempt: attempt({ ticket_id: 99 }),
    });
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('Review attempt not found for this ticket');
  });

  it('returns the existing request for a repeated attempt id', async () => {
    const existing = fixRequest();
    const { client, state } = fakeClient({ existingAttemptRequest: [existing] });
    const service = new FixRequestService();

    const result = await service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID });

    expect(result.created).toBe(false);
    expect(result.request).toEqual(existing);
    expect(state.queries.some((query) => query.sql.includes('UPDATE tickets'))).toBe(false);
    expect(state.queries.some((query) =>
      query.sql.includes('INSERT INTO ticket_fix_requests'))).toBe(false);
  });

  it('rejects a non-completed or non-request-changes attempt', async () => {
    const service = new FixRequestService();

    const pending = fakeClient({ attempt: attempt({ status: 'started' }) });
    await expect(service.createOrEnsureWithClient(
      pending.client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('Review attempt is not completed');

    const comment = fakeClient({ attempt: attempt({ verdict: 'comment' }) });
    await expect(service.createOrEnsureWithClient(
      comment.client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('Review attempt did not request changes');
    expect(comment.state.queries.some((query) =>
      query.sql.includes('UPDATE tickets'))).toBe(false);
  });

  it('rejects an attempt that belongs to another ticket', async () => {
    const { client } = fakeClient({ attempt: attempt({ ticket_id: 99 }) });
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('Review attempt not found for this ticket');
  });

  it('fails closed when the branch is missing', async () => {
    const { client, state } = fakeClient({ ticket: ticket({ branch_name: null }) });
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('Ticket branch is unavailable');
    expect(state.queries.some((query) => query.sql.includes('UPDATE tickets'))).toBe(false);
  });

  it('rejects a second active request for a different attempt', async () => {
    const { client } = fakeClient({ active: [fixRequest()] });
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('An active fix request already exists');
  });

  it('supports a manual request from the latest completed review', async () => {
    const latest = { reviewed_sha: SHA, round: 2 };
    const inserted = fixRequest({ attempt_id: null, source: 'human', feedback: 'fix the filter' });
    const { client, state } = fakeClient({ latestAttempt: latest, inserted });
    const service = new FixRequestService();

    const result = await service.createOrEnsureWithClient(
      client, TICKET_ID, { feedback: 'fix the filter' }, { actorId: 7 });

    expect(result.created).toBe(true);
    expect(result.request).toEqual(inserted);
    const update = state.queries.find((query) => query.sql.includes('UPDATE tickets'));
    expect(update.params).toEqual([TICKET_ID, 2, SHA, BRANCH]);
    const phase = state.queries.find((query) => query.sql.includes('INSERT INTO ticket_phases'));
    expect(phase.params.slice(0, 4)).toEqual([TICKET_ID, 'review', 'human', '7']);
    const insert = state.queries.find((query) =>
      query.sql.includes('INSERT INTO ticket_fix_requests'));
    expect(insert.params).toEqual([
      TICKET_ID, null, 'human', BRANCH, SHA, 'fix the filter',
    ]);
  });

  it('requires feedback for a manual request', async () => {
    const { client } = fakeClient();
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(client, TICKET_ID, {}))
      .rejects.toThrow('feedback is required');
  });

  it('rejects a request when the ticket is no longer in review', async () => {
    const { client } = fakeClient({ ticket: ticket({ status: 'in_progress' }) });
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(
      client, TICKET_ID, { attemptId: ATTEMPT_ID }))
      .rejects.toThrow('Ticket must be in review');
  });

  it('runs inside the transaction helper when no client is supplied', async () => {
    const { client } = fakeClient();
    transaction.mockImplementation(async (fn) => fn(client));
    const service = new FixRequestService();

    const result = await service.createOrEnsure(TICKET_ID, { attemptId: ATTEMPT_ID });

    expect(result.created).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
