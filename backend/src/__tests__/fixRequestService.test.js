jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  transaction: jest.fn(),
}));

const { pool, transaction } = require('../db');
const { FixRequestService } = require('../services/FixRequestService');
const FixBranchResolver = require('../services/FixBranchResolver');
const Ticket = require('../models/ticket');

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

  it('uses the branch resolver fallback for an older row', async () => {
    const branchResolver = {
      resolve: jest.fn().mockResolvedValue({
        branch: 'feat/from-pr',
        reviewedSha: SHA,
        round: 0,
      }),
    };
    const { client, state } = fakeClient({
      ticket: ticket({ branch_name: null, reviewed_sha: null }),
      latestAttempt: { reviewed_sha: null, round: 0 },
      inserted: fixRequest({ branch: 'feat/from-pr', attempt_id: null, source: 'human' }),
    });
    const service = new FixRequestService({ branchResolver });

    const result = await service.createOrEnsureWithClient(
      client, TICKET_ID, { feedback: 'fix it' });

    expect(result.created).toBe(true);
    expect(branchResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ id: TICKET_ID }),
      { reviewedSha: null, round: 0 }
    );
    const update = state.queries.find((query) => query.sql.includes('UPDATE tickets'));
    expect(update.params).toEqual([TICKET_ID, 0, SHA, 'feat/from-pr']);
  });

  it('rejects a stale pre-resolved base inside the transaction', async () => {
    const { client, state } = fakeClient({
      attempt: attempt({ reviewed_sha: 'b'.repeat(40), round: 2 }),
    });
    const service = new FixRequestService();

    await expect(service.createOrEnsureWithClient(
      client,
      TICKET_ID,
      { attemptId: ATTEMPT_ID },
      {
        branchResolution: {
          branch: BRANCH,
          reviewedSha: SHA,
          round: 1,
        },
      }
    )).rejects.toThrow('review base changed');
    expect(state.queries.some((query) => query.sql.includes('UPDATE tickets'))).toBe(false);
    expect(state.queries.some((query) =>
      query.sql.includes('INSERT INTO ticket_fix_requests'))).toBe(false);
  });

  it('accepts a pre-resolved manual SHA when the cache is empty', async () => {
    const inserted = fixRequest({
      attempt_id: null,
      source: 'human',
      branch: BRANCH,
      reviewed_sha: SHA,
      feedback: 'fix it',
    });
    const { client, state } = fakeClient({
      ticket: ticket({ branch_name: null, reviewed_sha: null }),
      latestAttempt: null,
      inserted,
    });
    const service = new FixRequestService();

    const result = await service.createOrEnsureWithClient(
      client,
      TICKET_ID,
      { feedback: 'fix it' },
      {
        branchResolution: {
          branch: BRANCH,
          reviewedSha: SHA,
          round: 0,
        },
      }
    );

    expect(result.created).toBe(true);
    const update = state.queries.find((query) => query.sql.includes('UPDATE tickets'));
    expect(update.params).toEqual([TICKET_ID, 0, SHA, BRANCH]);
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
    pool.query.mockImplementation((sql, params) => client.query(sql, params));
    transaction.mockImplementation(async (fn) => fn(client));
    const service = new FixRequestService();

    const result = await service.createOrEnsure(TICKET_ID, { attemptId: ATTEMPT_ID });

    expect(result.created).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});


function resolverTicket(overrides = {}) {
  return {
    id: 42,
    project_id: 7,
    branch_name: 'feat/ticket-42',
    pr_url: 'https://github.com/example/repo/pull/9',
    reviewed_sha: SHA,
    review_round: 1,
    ...overrides,
  };
}

describe('FixBranchResolver (fg-32b2)', () => {
  it('verifies a stored ticket branch against the review head', async () => {
    let calls = 0;
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => {
        calls++;
        return { branch: 'feat/ticket-42', headSha: SHA };
      },
    });

    const resolved = await resolver.resolve(resolverTicket(), { round: 1 });

    expect(calls).toBe(1);
    expect(resolved).toEqual({
      branch: 'feat/ticket-42',
      reviewedSha: SHA,
      round: 1,
    });
  });

  it('falls back to the review head branch and SHA for older rows', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/from-pr',
        headSha: SHA,
      }),
    });

    const resolved = await resolver.resolve(
      resolverTicket({ branch_name: null, reviewed_sha: null }),
      { round: 0 }
    );

    expect(resolved.branch).toBe('feat/from-pr');
    expect(resolved.reviewedSha).toBe(SHA);
    expect(resolved.round).toBe(0);
  });

  it('fills a missing SHA from the review head when the branch is stored', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/ticket-42',
        headSha: SHA,
      }),
    });

    const resolved = await resolver.resolve(
      resolverTicket({ reviewed_sha: null }),
      { round: 2 }
    );

    expect(resolved.branch).toBe('feat/ticket-42');
    expect(resolved.reviewedSha).toBe(SHA);
    expect(resolved.round).toBe(2);
  });

  it('fails closed on a mismatch even when the SHA is cached', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/other',
        headSha: SHA,
      }),
    });

    await expect(resolver.resolve(resolverTicket(), { round: 1 }))
      .rejects.toThrow('does not match the PR head branch');
  });

  it('fails closed when the stored branch disagrees with the review head', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/other',
        headSha: SHA,
      }),
    });

    await expect(resolver.resolve(
      resolverTicket({ reviewed_sha: null }),
      { round: 0 }
    )).rejects.toThrow('does not match the PR head branch');
  });

  it('fails closed when no branch or SHA can be resolved', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => null,
    });

    await expect(resolver.resolve(
      resolverTicket({ branch_name: null }), { round: 0 }
    )).rejects.toThrow('Could not resolve the review request head');

    await expect(new FixBranchResolver().resolve(
      resolverTicket({ branch_name: null, pr_url: null }), { round: 0 }
    )).rejects.toThrow('Ticket branch is unavailable');

    await expect(new FixBranchResolver().resolve(
      resolverTicket({ reviewed_sha: null, pr_url: null }), { round: 0 }
    )).rejects.toThrow('No reviewed SHA is available');
  });

  it('falls through an empty branchName to fix_branch', async () => {
    const resolved = await new FixBranchResolver().resolve(
      resolverTicket({ branchName: '', branch_name: null, fix_branch: 'feat/fix-cache', pr_url: null }),
      { round: 0 }
    );

    expect(resolved.branch).toBe('feat/fix-cache');
  });

  it('rejects an invalid SHA and an oversized branch', async () => {
    await expect(new FixBranchResolver().resolve(
      resolverTicket({ reviewed_sha: 'abc1234', pr_url: null }), { round: 0 }
    )).rejects.toThrow('No valid reviewed SHA');

    await expect(new FixBranchResolver().resolve(
      resolverTicket({ branch_name: 'b'.repeat(256), pr_url: null }), { round: 0 }
    )).rejects.toThrow('exceeds 255');
  });
});

describe('Ticket review cache fields (fg-32b2)', () => {
  it('maps branch/fix/reviewer fields from a row', () => {
    const ticket = Ticket.fromRow({
      id: 1,
      project_id: 2,
      title: 'Fix login',
      status: 'review',
      branch_name: 'feat/ticket-1',
      fix_branch: 'feat/ticket-1',
      reviewed_sha: 'a'.repeat(40),
      review_round: 2,
    });

    expect(ticket.branchName).toBe('feat/ticket-1');
    expect(ticket.fixBranch).toBe('feat/ticket-1');
    expect(ticket.reviewedSha).toBe('a'.repeat(40));
    expect(ticket.reviewRound).toBe(2);
  });
});
