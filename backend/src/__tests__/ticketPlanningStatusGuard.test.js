jest.mock('../db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

jest.mock('../services/TicketReadinessService', () => ({
  refreshReadyState: jest.fn().mockResolvedValue(undefined),
  seedCriteriaFromPlanning: jest.fn().mockResolvedValue([]),
}));

const { pool } = require('../db');
const TicketPlanningService = require('../services/TicketPlanningService');
const TicketReadinessService = require('../services/TicketReadinessService');
const { ValidationError, NotFoundError } = require('../errors/HttpError');

describe('fg-45 planning status guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('completed cannot be written directly', async () => {
    await expect(
      TicketPlanningService.updateStatus('10', 'completed', '100')
    ).rejects.toMatchObject({ code: 'PLANNING_STATUS_FORBIDDEN', statusCode: 409 });
  });

  test('leaving completed requires replan', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ planning_status: 'completed' }] });

    await expect(
      TicketPlanningService.updateStatus('10', 'in_progress', '100')
    ).rejects.toMatchObject({ code: 'REPLAN_REQUIRED', statusCode: 409 });
  });

  test('the authoring states still update', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ planning_status: 'not_started' }] })
      .mockResolvedValueOnce({ rows: [] });

    await TicketPlanningService.updateStatus('10', 'in_progress', '100');

    expect(pool.query).toHaveBeenLastCalledWith(
      'UPDATE tickets SET planning_status = $1, updated_at = NOW() WHERE id = $2',
      ['in_progress', '10']
    );
  });

  test('an unknown status is a 400 validation error', async () => {
    await expect(
      TicketPlanningService.updateStatus('10', 'approved', '100')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('a missing ticket is a 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      TicketPlanningService.updateStatus('10', 'in_progress', '100')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('the post-approval refresh re-evaluates instead of trusting completed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ planning_status: 'not_started' }] })
      .mockResolvedValueOnce({ rows: [] });

    await TicketPlanningService.updateStatus('10', 'template_selected', '100');

    expect(TicketReadinessService.refreshReadyState).not.toHaveBeenCalled();
  });
});
