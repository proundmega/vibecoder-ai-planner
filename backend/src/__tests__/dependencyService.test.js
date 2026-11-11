jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const { pool } = require('../db');
const DependencyService = require('../services/DependencyService');
const { DependencyConflictError } = require('../errors/HttpError');

function target(overrides = {}) {
  return {
    id: '10',
    project_id: '1',
    depends_on: [],
    ...overrides,
  };
}

function dep(overrides = {}) {
  return {
    id: '5',
    project_id: '1',
    deleted_at: null,
    title: 'Create the schema',
    status: 'in_progress',
    phase: 'assigned',
    ...overrides,
  };
}

const startedAt = { created_at: new Date('2026-11-10T10:00:00Z') };

describe('DependencyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ready when a ticket has no dependencies', async () => {
    pool.query.mockResolvedValueOnce({ rows: [target()] });

    await expect(DependencyService.readiness('10')).resolves.toEqual({
      ready: true,
      blockedBy: [],
    });
  });

  it('returns ready when every dependency is done or deployed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [target({ depends_on: ['5', '6'] })] })
      .mockResolvedValueOnce({ rows: [startedAt] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          dep({ id: '5', status: 'done', phase: 'done' }),
          dep({ id: '6', status: 'done', phase: 'deployed' }),
        ],
      });

    await expect(DependencyService.readiness('10')).resolves.toEqual({
      ready: true,
      blockedBy: [],
    });
  });

  it('reports an incomplete dependency with title and status', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [target({ depends_on: ['5'] })] })
      .mockResolvedValueOnce({ rows: [startedAt] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [dep()] });

    await expect(DependencyService.readiness('10')).resolves.toEqual({
      ready: false,
      blockedBy: [
        {
          id: '5',
          title: 'Create the schema',
          status: 'in_progress',
          phase: 'assigned',
          reason: 'not_done',
        },
      ],
    });
  });

  it('reports missing, deleted, self and cross-project entries without leaking details', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [target({ depends_on: ['10', '5', '6', '7'] })],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          dep({ id: '5', deleted_at: new Date() }),
          dep({ id: '6', project_id: '2', title: 'Other project' }),
        ],
      });

    const result = await DependencyService.readiness('10');

    expect(result.ready).toBe(false);
    expect(result.blockedBy).toEqual([
      { id: '10', title: null, status: null, phase: null, reason: 'self' },
      { id: '5', title: null, status: null, phase: null, reason: 'deleted' },
      { id: '6', title: null, status: null, phase: null, reason: 'cross_project' },
      { id: '7', title: null, status: null, phase: null, reason: 'missing' },
    ]);
  });

  it('marks a dependency reopened after the dependent started', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [target({ depends_on: ['5'] })] })
      .mockResolvedValueOnce({ rows: [startedAt] })
      .mockResolvedValueOnce({
        rows: [
          {
            ticket_id: '5',
            from_phase: 'done',
            to_phase: 'in_progress',
            created_at: new Date('2026-11-10T11:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [dep({ status: 'in_progress', phase: 'in_progress' })] });

    const result = await DependencyService.readiness('10');

    expect(result.blockedBy[0].reason).toBe('dependency_reopened');
  });

  it('locks the target and same-project dependency rows for a start', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [target({ depends_on: ['5'] })] })
      .mockResolvedValueOnce({ rows: [startedAt] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [dep({ status: 'done', phase: 'done' })] })
      .mockResolvedValueOnce({ rows: [dep({ status: 'done', phase: 'done' })] });

    await expect(DependencyService.readiness('10', { lock: true })).resolves.toEqual({
      ready: true,
      blockedBy: [],
    });

    expect(pool.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(pool.query.mock.calls[4][0]).toContain('FOR UPDATE');
    expect(pool.query.mock.calls[4][0]).toContain('project_id = $2');
  });

  it('fails closed before locking an unresolved entry', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [target({ depends_on: ['5'] })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [dep({ id: '5', project_id: '2' })] });

    const result = await DependencyService.readiness('10', { lock: true });

    expect(result.ready).toBe(false);
    expect(pool.query.mock.calls).toHaveLength(4);
    expect(
      pool.query.mock.calls.some(call => String(call[0]).includes('project_id = $2'))
    ).toBe(false);
  });

  it('throws DEPENDENCIES_NOT_DONE with blockedBy details', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [target({ depends_on: ['5'] })] })
      .mockResolvedValueOnce({ rows: [startedAt] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [dep()] });

    const assertion = DependencyService.assertReady('10');

    await expect(assertion).rejects.toMatchObject({
      code: 'DEPENDENCIES_NOT_DONE',
      statusCode: 409,
      details: {
        ticketId: '10',
        blockedBy: [expect.objectContaining({ id: '5', reason: 'not_done' })],
      },
    });
    await expect(assertion).rejects.toBeInstanceOf(DependencyConflictError);
  });

  it('enriches a list with one dependency query batch', async () => {
    const tickets = [
      { id: '10', projectId: '1', dependsOn: ['5'] },
      { id: '11', projectId: '1', dependsOn: [] },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [dep({ status: 'done', phase: 'done' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ticket_id: '10', created_at: startedAt.created_at }] });

    const enriched = await DependencyService.enrich(tickets);

    expect(enriched[0].ready).toBe(true);
    expect(enriched[1].ready).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
