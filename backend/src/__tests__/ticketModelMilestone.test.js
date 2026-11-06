const { pool } = require('../db');
const Ticket = require('../models/ticket');

jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');

const row = {
  id: 1,
  project_id: 7,
  title: 'Milestoned',
  status: 'backlog',
  priority: 'medium',
  owner_id: 100,
  milestone_id: '123e4567-e89b-12d3-a456-426614174000',
  estimate: 8,
  depends_on: [2, 3],
  created_at: new Date(),
  updated_at: new Date(),
};

describe('Ticket model milestone fields (bp-124 O1/O6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps milestone columns onto the model', () => {
    const ticket = Ticket.fromRow(row);

    expect(ticket.milestoneId).toBe(row.milestone_id);
    expect(ticket.estimate).toBe(8);
    expect(ticket.dependsOn).toEqual([2, 3]);
  });

  it('includes milestone columns in the UPDATE SET clause', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row] }) // findById
      .mockResolvedValueOnce({ rows: [row] }); // UPDATE ... RETURNING *

    await Ticket.update(1, {
      milestoneId: row.milestone_id,
      estimate: 8,
      dependsOn: [2, 3],
    });

    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toContain('milestone_id = $');
    expect(sql).toContain('estimate = $');
    expect(sql).toContain('depends_on = $');
    expect(sql).toContain('RETURNING *');
    expect(params).toEqual([row.milestone_id, 8, [2, 3], 1]);
  });

  it('returns the persisted ticket so the controller can respond with it', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] });

    const updated = await Ticket.update(1, { estimate: 8 });

    expect(updated).toBeInstanceOf(Ticket);
    expect(updated.estimate).toBe(8);
  });

  it('does not touch milestone columns when they are omitted', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] });

    await Ticket.update(1, { title: 'Only title' });

    const [sql] = pool.query.mock.calls[1];
    expect(sql).not.toContain('milestone_id');
    expect(sql).not.toContain('estimate');
    expect(sql).not.toContain('depends_on');
  });

  it('clears milestoneId when null is passed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, milestone_id: null }] });

    const updated = await Ticket.update(1, { milestoneId: null });

    const [, params] = pool.query.mock.calls[1];
    expect(params[0]).toBeNull();
    expect(updated.milestoneId).toBeNull();
  });
});
