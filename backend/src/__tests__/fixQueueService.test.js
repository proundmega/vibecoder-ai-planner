jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  transaction: jest.fn(),
}));

const { pool, transaction } = require('../db');
const { FixQueueService } = require('../services/FixQueueService');

const TICKET_ID = 42;
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const RUNTIME_ID = 3;

function requestRow(overrides = {}) {
  return {
    id: REQUEST_ID,
    ticket_id: TICKET_ID,
    project_id: 7,
    state: 'queued',
    claimed_by: null,
    lease_expires_at: null,
    next_attempt_at: null,
    due: true,
    lease_live: false,
    ...overrides,
  };
}

function fakeClient({ selected = [], updated = null, audits = [] } = {}) {
  const client = {
    query: jest.fn(async (sql, params) => {
      if (sql.includes('FROM ticket_fix_requests fr')
          && (sql.includes('JOIN tickets') || sql.includes('lease_live'))) {
        return { rows: selected };
      }
      if (sql.includes('UPDATE ticket_fix_requests')) {
        return { rows: updated ? [updated] : [] };
      }
      if (sql.includes('UPDATE tickets')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO harness_events')) {
        audits.push(params);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return { client, audits };
}

describe('FixQueueService (fg-32b1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists due queued requests for a project', async () => {
    pool.query.mockResolvedValue({ rows: [requestRow()] });
    const service = new FixQueueService();

    const rows = await service.listQueue(7, { limit: 5 });

    expect(rows).toHaveLength(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("fr.state = 'queued'"),
      [7, 5]
    );
  });

  it('validates the project and queue limit', async () => {
    const service = new FixQueueService();

    await expect(service.listQueue(0)).rejects.toThrow('projectId must be a positive integer');
    await expect(service.listQueue(7, { limit: 0 })).rejects.toThrow('limit must be between');
  });

  it('claims a due queued request and marks the ticket fixing', async () => {
    const claimed = requestRow({ state: 'claimed', claimed_by: RUNTIME_ID });
    const { client } = fakeClient({
      selected: [requestRow()],
      updated: claimed,
    });
    const service = new FixQueueService();

    const result = await service.claimWithClient(client, TICKET_ID, RUNTIME_ID, 120);

    expect(result).toEqual({ request: claimed, claimed: true, reclaimed: false });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("review_state = 'fixing'"),
      [TICKET_ID]
    );
  });

  it('returns the existing claim for the same live owner', async () => {
    const row = requestRow({
      state: 'claimed',
      claimed_by: RUNTIME_ID,
      lease_live: true,
    });
    const { client } = fakeClient({ selected: [row] });
    const service = new FixQueueService();

    const result = await service.claimWithClient(client, TICKET_ID, RUNTIME_ID, 120);

    expect(result).toEqual({ request: row, claimed: false, reclaimed: false });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ticket_fix_requests'),
      expect.anything()
    );
  });

  it('rejects a live lease owned by another runtime', async () => {
    const { client } = fakeClient({
      selected: [requestRow({
        state: 'claimed',
        claimed_by: 9,
        lease_live: true,
      })],
    });
    const service = new FixQueueService();

    await expect(service.claimWithClient(client, TICKET_ID, RUNTIME_ID, 120))
      .rejects.toThrow('claimed by another agent');
  });

  it('reclaims an expired lease and records an audit event', async () => {
    const expired = requestRow({
      state: 'claimed',
      claimed_by: 9,
      lease_live: false,
    });
    const reclaimed = requestRow({ state: 'claimed', claimed_by: RUNTIME_ID });
    const { client, audits } = fakeClient({ selected: [expired], updated: reclaimed });
    const service = new FixQueueService();

    const result = await service.claimWithClient(client, TICKET_ID, RUNTIME_ID, 120);

    expect(result).toEqual({ request: reclaimed, claimed: true, reclaimed: true });
    expect(audits).toHaveLength(1);
    expect(audits[0][2]).toBe(RUNTIME_ID);
    expect(JSON.parse(audits[0][3])).toEqual(expect.objectContaining({ previousOwner: 9 }));
  });

  it('rejects a queued request that is not due', async () => {
    const { client } = fakeClient({
      selected: [requestRow({ due: false })],
    });
    const service = new FixQueueService();

    await expect(service.claimWithClient(client, TICKET_ID, RUNTIME_ID, 120))
      .rejects.toThrow('not due yet');
  });

  it('rejects a claim when there is no active request', async () => {
    const { client } = fakeClient({ selected: [] });
    const service = new FixQueueService();

    await expect(service.claimWithClient(client, TICKET_ID, RUNTIME_ID, 120))
      .rejects.toThrow('No active fix request');
  });

  it('renews a live lease owned by the caller', async () => {
    const renewed = requestRow({
      state: 'claimed',
      claimed_by: RUNTIME_ID,
      lease_live: true,
    });
    const { client } = fakeClient({
      selected: [requestRow({ state: 'claimed', claimed_by: RUNTIME_ID, lease_live: true })],
      updated: renewed,
    });
    const service = new FixQueueService();

    const result = await service.renewWithClient(client, TICKET_ID, RUNTIME_ID, 120);

    expect(result).toEqual(renewed);
  });

  it('rejects renew for another owner, an expired lease or no claim', async () => {
    const service = new FixQueueService();

    const other = fakeClient({
      selected: [requestRow({ state: 'claimed', claimed_by: 9, lease_live: true })],
    });
    await expect(service.renewWithClient(other.client, TICKET_ID, RUNTIME_ID, 120))
      .rejects.toThrow('not owned by this agent');

    const expired = fakeClient({
      selected: [requestRow({ state: 'claimed', claimed_by: RUNTIME_ID, lease_live: false })],
    });
    await expect(service.renewWithClient(expired.client, TICKET_ID, RUNTIME_ID, 120))
      .rejects.toThrow('expired');

    const missing = fakeClient({ selected: [] });
    await expect(service.renewWithClient(missing.client, TICKET_ID, RUNTIME_ID, 120))
      .rejects.toThrow('No claimed fix request');
  });

  it('runs claim inside the transaction helper', async () => {
    const claimed = requestRow({ state: 'claimed', claimed_by: RUNTIME_ID });
    const { client } = fakeClient({ selected: [requestRow()], updated: claimed });
    transaction.mockImplementation(async (fn) => fn(client));
    const service = new FixQueueService();

    const result = await service.claim(TICKET_ID, {
      runtimeId: RUNTIME_ID,
      leaseSeconds: 120,
    });

    expect(result.claimed).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
