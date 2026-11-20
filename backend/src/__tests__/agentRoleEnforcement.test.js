jest.mock('../db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

const { pool } = require('../db');
const {
  requireRuntime,
  requireRole,
  requireTicketGrant,
  requireBodyGrant,
  requireProjectGrant,
  requireRunGrant,
  requireReviewEventGrant,
} = require('../middleware/agentRole');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function nodeRequest({ role = 'worker', status = 'running', projectId = 5, nodeId = 12 } = {}) {
  return {
    agent: { _node: true, node_id: nodeId },
    node: { id: nodeId },
    runtime: { id: 3, role, status, current_project_id: projectId },
    params: { ticketId: '1' },
    body: {},
  };
}

async function run(middleware, req) {
  const res = response();
  const next = jest.fn();
  await middleware(req, res, next);
  return { res, next };
}

describe('agent role enforcement (FR4, NFR1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('lets legacy agent keys through untouched', async () => {
    const req = { agent: { id: 7 }, params: { ticketId: '1' }, body: {} };
    const { res, next } = await run(requireTicketGrant('worker'), req);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('denies a runtime that is not running', async () => {
    const req = nodeRequest({ status: 'stopped' });
    const { res, next } = await run(requireRuntime('running'), req);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('RUNTIME_INACTIVE');
    expect(next).not.toHaveBeenCalled();
  });

  it('denies a role outside the allowlist', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    const { res, next } = await run(requireTicketGrant('worker'), req);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('requires an active grant for the ticket project', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    pool.query
      .mockResolvedValueOnce({ rows: [{ project_id: 5 }] })
      .mockResolvedValueOnce({ rows: [] });

    const { res, next } = await run(requireTicketGrant('reviewer'), req);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('GRANT_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a granted reviewer on a review route', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    pool.query
      .mockResolvedValueOnce({ rows: [{ project_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const { res, next } = await run(requireTicketGrant('reviewer'), req);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('denies a worker on a planner-only role check', async () => {
    const req = nodeRequest({ role: 'worker' });
    const { res, next } = await run(requireRole('planner'), req);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });


  it('audits an inactive-runtime denial', async () => {
    const req = nodeRequest({ status: 'stopped' });
    const { res } = await run(requireRuntime('running'), req);

    expect(res.statusCode).toBe(403);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_node_auth_events'),
      expect.arrayContaining([12, null, 'auth.runtime_inactive'])
    );
  });

  it('audits a role denial', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    const { res } = await run(requireRole('worker'), req);

    expect(res.statusCode).toBe(403);
    expect(pool.query.mock.calls.some(([sql, params]) =>
      sql.includes('agent_node_auth_events') && params[2] === 'auth.role_denied'
    )).toBe(true);
  });


  it('uses the runtime identity when the node owner is also present', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    req.user = { userId: 7, role: 'project_admin' };
    const { res } = await run(requireRole('worker'), req);

    expect(res.statusCode).toBe(403);
    const audit = pool.query.mock.calls.find(([sql, params]) =>
      sql.includes('agent_node_auth_events') && params[2] === 'auth.role_denied'
    );
    expect(audit[1][3]).toBe('runtime');
    expect(audit[1][4]).toBe('3');
  });

  it('audits a grant denial with the project', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    pool.query
      .mockResolvedValueOnce({ rows: [{ project_id: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { res } = await run(requireTicketGrant('reviewer'), req);

    expect(res.statusCode).toBe(403);
    expect(pool.query.mock.calls.some(([sql, params]) =>
      sql.includes('agent_node_auth_events')
        && params[1] === 5
        && params[2] === 'auth.grant_denied'
    )).toBe(true);
  });

  it('checks body-grant roles for review events', async () => {
    const req = nodeRequest({ role: 'worker' });
    req.body = { type: 'review.result', projectId: 5 };
    const { res, next } = await run(requireReviewEventGrant(), req);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('allows non-review events through the review gate', async () => {
    const req = nodeRequest({ role: 'worker' });
    req.body = { type: 'run.started', projectId: 5 };
    const { next } = await run(requireReviewEventGrant(), req);

    expect(next).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('resolves the project from a body ticket id', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    req.body = { type: 'review.result', ticketId: 9 };
    pool.query
      .mockResolvedValueOnce({ rows: [{ project_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const { res, next } = await run(requireBodyGrant('reviewer'), req);

    expect(next).toHaveBeenCalled();
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      'SELECT project_id FROM tickets WHERE id = $1',
      [9]
    );
    expect(res.statusCode).toBe(200);
  });


  it('rejects malformed ticket ids before querying the database', async () => {
    const req = nodeRequest();
    req.params.ticketId = 'not-a-number';
    const { res, next } = await run(requireTicketGrant('worker'), req);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(next).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects malformed run ids before querying the database', async () => {
    const req = nodeRequest();
    req.params.runId = 'not-a-uuid';
    const { res, next } = await run(requireRunGrant('worker'), req);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(next).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects malformed project ids before querying the database', async () => {
    const req = nodeRequest();
    req.params.projectId = 'not-a-number';
    const { res, next } = await run(requireProjectGrant('worker'), req);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(next).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects malformed body ids before querying the database', async () => {
    const req = nodeRequest();
    req.body = { projectId: 'nope' };
    const { res, next } = await run(requireBodyGrant('worker'), req);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(next).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a body-grant request with no project', async () => {
    const req = nodeRequest({ role: 'reviewer' });
    req.body = { type: 'review.result' };
    const { res, next } = await run(requireBodyGrant('reviewer'), req);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('GRANT_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });
});
