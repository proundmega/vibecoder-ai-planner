const ReviewService = require('../services/ReviewService');
const db = require('../db');

describe('ReviewService', () => {
  const pool = db.pool;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveLocalDiff', () => {
    it('returns early for non-array input', async () => {
      const result = await ReviewService.saveLocalDiff('t1', null);
      expect(result).toEqual({ saved: 0 });
    });

    it('returns early for empty array', async () => {
      const result = await ReviewService.saveLocalDiff('t1', []);
      expect(result).toEqual({ saved: 0 });
    });

    it('skips entries missing path or action', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce(null) // INSERT valid
          .mockResolvedValueOnce(null) // COMMIT
        ,
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      const files = [
        { path: 'a.js', action: 'add', new_content: 'code' },
        { path: 'b.js' }, // missing action — skipped
        { action: 'modify' }, // missing path — skipped
      ];

      const result = await ReviewService.saveLocalDiff('t1', files);

      expect(result).toEqual({ saved: 1 });
      expect(mockClient.query).toHaveBeenCalledTimes(3); // BEGIN + 1 INSERT + COMMIT
    });

    it('UPSERTs with COALESCE for existing entries', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce(null) // INSERT
          .mockResolvedValueOnce(null) // COMMIT
        ,
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      await ReviewService.saveLocalDiff('t1', [
        { path: 'a.js', action: 'modify', old_content: 'old', new_content: 'new' },
      ]);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ON CONFLICT'),
        ['t1', 'a.js', 'modify', 'old', 'new']
      );
    });

    it('nulls old_content and new_content when not provided', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      await ReviewService.saveLocalDiff('t1', [
        { path: 'a.js', action: 'add' },
      ]);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        ['t1', 'a.js', 'add', null, null]
      );
    });

    it('rolls back on error', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce(null) // BEGIN
          .mockRejectedValueOnce(new Error('DB error')),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(mockClient);

      await expect(ReviewService.saveLocalDiff('t1', [{ path: 'a.js', action: 'add' }])).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('getLocalDiff', () => {
    it('returns diffs ordered by file_path', async () => {
      const mockRows = [
        { file_path: 'a.js', action: 'add' },
        { file_path: 'b.js', action: 'modify' },
      ];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await ReviewService.getLocalDiff('t1');

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM review_diffs WHERE ticket_id = $1 ORDER BY file_path',
        ['t1']
      );
      expect(result).toEqual(mockRows);
    });

    it('returns empty array when no diffs', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await ReviewService.getLocalDiff('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('clearLocalDiff', () => {
    it('deletes all diffs for a ticket', async () => {
      await ReviewService.clearLocalDiff('t1');

      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM review_diffs WHERE ticket_id = $1',
        ['t1']
      );
    });
  });
});
