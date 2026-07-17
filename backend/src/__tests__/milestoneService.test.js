const MilestoneService = require('../services/MilestoneService');
// HttpError imported for type reference

describe('MilestoneService', () => {
  const pool = require('../db').pool;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('queries milestones by project_id ordered by created_at DESC', async () => {
      const mockRows = [
        { id: 'm1', project_id: 1, name: 'Milestone 1', created_at: new Date() },
        { id: 'm2', project_id: 1, name: 'Milestone 2', created_at: new Date(2024, 0, 1) },
      ];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MilestoneService.list(1);

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM milestones WHERE project_id = $1 ORDER BY created_at DESC',
        [1]
      );
      expect(result).toEqual(mockRows);
    });

    it('returns empty array when no milestones exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await MilestoneService.list(999);

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM milestones WHERE project_id = $1 ORDER BY created_at DESC',
        [999]
      );
      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('throws ValidationError for empty name', async () => {
      await expect(MilestoneService.create(1, { name: '' })).rejects.toThrow('Milestone name is required');
    });

    it('throws ValidationError for whitespace-only name', async () => {
      await expect(MilestoneService.create(1, { name: '   ' })).rejects.toThrow('Milestone name is required');
    });

    it('creates milestone with transaction (BEGIN/COMMIT)', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // deactivate
          .mockResolvedValueOnce({ rows: [{ id: 'm1', project_id: 1, name: 'New Milestone' }] }) // INSERT
          .mockResolvedValueOnce(null), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const result = await MilestoneService.create(1, { name: 'New Milestone', description: 'desc', targetDate: '2024-06-30' });

      expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockClient.query).toHaveBeenNthCalledWith(
        2,
        'UPDATE milestones SET is_active=false WHERE project_id=$1 AND is_active=true',
        [1]
      );
      expect(mockClient.query).toHaveBeenNthCalledWith(
        3,
        'INSERT INTO milestones (project_id, name, description, target_date) VALUES ($1, $2, $3, $4) RETURNING *',
        [1, 'New Milestone', 'desc', '2024-06-30']
      );
      expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
      expect(result).toEqual({ id: 'm1', project_id: 1, name: 'New Milestone' });
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('trims name and nulls optional fields', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // deactivate
          .mockResolvedValueOnce({ rows: [{ id: 'm1' }] }) // INSERT
          .mockResolvedValueOnce(null), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      await MilestoneService.create(1, { name: '  Trimmed  ' });

      expect(mockClient.query).toHaveBeenNthCalledWith(
        3,
        'INSERT INTO milestones (project_id, name, description, target_date) VALUES ($1, $2, $3, $4) RETURNING *',
        [1, 'Trimmed', null, null]
      );
    });

    it('rolls back on error', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')), // deactivate fails
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      await expect(MilestoneService.create(1, { name: 'Fail' })).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    });
  });

  describe('update', () => {
    it('throws ValidationError when no fields provided', async () => {
      await expect(MilestoneService.update('m1', {})).rejects.toThrow('No fields to update');
    });

    it('updates only name', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Updated' }] });

      const result = await MilestoneService.update('m1', { name: 'Updated' });

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE milestones SET name=$1 WHERE id=$2 RETURNING *',
        ['Updated', 'm1']
      );
      expect(result).toEqual({ id: 'm1', name: 'Updated' });
    });

    it('updates only description', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'm1', description: 'new desc' }] });

      await MilestoneService.update('m1', { description: 'new desc' });

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE milestones SET description=$1 WHERE id=$2 RETURNING *',
        ['new desc', 'm1']
      );
    });

    it('updates only targetDate', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'm1', target_date: '2025-01-01' }] });

      await MilestoneService.update('m1', { targetDate: '2025-01-01' });

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE milestones SET target_date=$1 WHERE id=$2 RETURNING *',
        ['2025-01-01', 'm1']
      );
    });

    it('updates all fields with positional params', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'All', description: 'desc', target_date: '2025-01-01' }] });

      await MilestoneService.update('m1', { name: 'All', description: 'desc', targetDate: '2025-01-01' });

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE milestones SET name=$1, description=$2, target_date=$3 WHERE id=$4 RETURNING *',
        ['All', 'desc', '2025-01-01', 'm1']
      );
    });

    it('throws NotFoundError when milestone not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(MilestoneService.update('nonexistent', { name: 'X' })).rejects.toThrow('Milestone not found');
    });
  });

  describe('getProgress', () => {
    it('calculates percentage from estimates', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ total_estimate: 100, completed_estimate: 50 }],
      });

      const result = await MilestoneService.getProgress('m1');

      expect(result).toEqual({ totalEstimate: 100, completedEstimate: 50, percentage: 50 });
    });

    it('returns 0% when total_estimate is 0', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ total_estimate: 0, completed_estimate: 0 }],
      });

      const result = await MilestoneService.getProgress('m1');

      expect(result).toEqual({ totalEstimate: 0, completedEstimate: 0, percentage: 0 });
    });

    it('handles COALESCE with no tickets', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ total_estimate: null, completed_estimate: null }],
      });

      const result = await MilestoneService.getProgress('m1');

      expect(result).toEqual({ totalEstimate: 0, completedEstimate: 0, percentage: 0 });
    });

    it('handles 100% completion', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ total_estimate: 80, completed_estimate: 80 }],
      });

      const result = await MilestoneService.getProgress('m1');

      expect(result).toEqual({ totalEstimate: 80, completedEstimate: 80, percentage: 100 });
    });
  });

  describe('getTickets', () => {
    it('queries tickets by milestone_id', async () => {
      const mockRows = [{ id: 't1', milestone_id: 'm1', title: 'Test' }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await MilestoneService.getTickets('m1');

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM tickets WHERE milestone_id = $1 ORDER BY created_at',
        ['m1']
      );
      expect(result).toEqual(mockRows);
    });

    it('returns empty array when no tickets', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await MilestoneService.getTickets('nonexistent');

      expect(result).toEqual([]);
    });
  });
});
