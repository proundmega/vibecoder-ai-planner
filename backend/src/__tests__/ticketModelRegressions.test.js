const Ticket = require('../models/ticket');
const { pool } = require('../db');

describe('Ticket model regression tests', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  describe('fromRow()', () => {
    it('preserves assignee_name and project_name from joined rows', () => {
      const ticket = Ticket.fromRow({
        id: 1,
        project_id: 2,
        title: 'Fix login',
        description: 'desc',
        status: 'backlog',
        priority: 'medium',
        assignee_id: 9,
        assignee_name: 'Alice',
        owner_id: 3,
        project_name: 'Project Alpha',
      });

      expect(ticket.assigneeName).toBe('Alice');
      expect(ticket.projectName).toBe('Project Alpha');
    });

    it('defaults name fields to null when the join produced no names', () => {
      const ticket = Ticket.fromRow({
        id: 1,
        project_id: 2,
        title: 'Fix login',
        status: 'backlog',
      });

      expect(ticket.assigneeName).toBeNull();
      expect(ticket.projectName).toBeNull();
    });
  });

  describe('create()', () => {
    it('returns camelCase projectId and ownerId', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 10,
          project_id: 2,
          title: 'New ticket',
          description: 'desc',
          status: 'backlog',
          priority: 'medium',
          owner_id: 7,
          phase: 'draft',
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        }],
      });

      const ticket = await Ticket.create(2, 'New ticket', 'desc', 'medium', 7);

      expect(ticket.projectId).toBe(2);
      expect(ticket.ownerId).toBe(7);
    });
  });

  describe('update()', () => {
    it('allows keeping the current status while changing other fields', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            project_id: 2,
            title: 'Old title',
            status: 'backlog',
            priority: 'medium',
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        Ticket.update(1, { title: 'New title', status: 'backlog' })
      ).resolves.toBeUndefined();

      expect(pool.query).toHaveBeenCalledTimes(2);
      const [sql, params] = pool.query.mock.calls[1];
      expect(sql).toContain('title =');
      expect(sql).toContain('status =');
      expect(params).toEqual(['New title', 'backlog', 1]);
    });

    it('still rejects an invalid status transition', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          project_id: 2,
          title: 'Old title',
          status: 'backlog',
          priority: 'medium',
        }],
      });

      await expect(
        Ticket.update(1, { status: 'done' })
      ).rejects.toThrow('Invalid status transition from backlog to done');

      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });
});
