const UsageLogger = require('../services/UsageLogger');
const { calculateCost } = require('../utils/pricing');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

const { pool } = require('../db');

describe('UsageLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should log usage with correct values', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}] });

      await UsageLogger.log(1, 2, 3, 'claude', 'claude-sonnet-4-20250514', {
        input_tokens: 1000,
        output_tokens: 500,
      }, 150, 10);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO usage_logs'),
        [1, 2, 3, 'claude', 'claude-sonnet-4-20250514', 1000, 500, expect.any(Number), 150, 10]
      );

      const cost = calculateCost('claude-sonnet-4-20250514', 1000, 500);
      expect(pool.query.mock.calls[0][1][7]).toBeCloseTo(cost);
    });

    it('should handle missing usage fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}] });

      await UsageLogger.log(1, 2, 3, 'openai', 'gpt-4o', {}, 100, null);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO usage_logs'),
        [1, 2, 3, 'openai', 'gpt-4o', 0, 0, 0, 100, null]
      );
    });
  });

  describe('getProjectUsage', () => {
    it('should return aggregated usage by provider and model', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            provider_type: 'claude',
            model: 'claude-sonnet-4-20250514',
            total_in: 10000,
            total_out: 5000,
            total_cost: 0.105,
            total_calls: 5,
          },
        ],
      });

      const since = new Date('2026-01-01');
      const until = new Date('2026-06-30');

      const result = await UsageLogger.getProjectUsage(1, since, until);

      expect(result).toHaveLength(1);
      expect(result[0].provider_type).toBe('claude');
      expect(parseInt(result[0].total_in)).toBe(10000);
    });
  });

  describe('getUserUsage', () => {
    it('should return aggregated usage by project and model', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            project_name: 'Test Project',
            provider_type: 'openai',
            model: 'gpt-4o',
            total_cost: 0.05,
            total_calls: 3,
          },
        ],
      });

      const since = new Date('2026-01-01');
      const until = new Date('2026-06-30');

      const result = await UsageLogger.getUserUsage(1, since, until);

      expect(result).toHaveLength(1);
      expect(result[0].project_name).toBe('Test Project');
    });
  });

  describe('getTotalUsage', () => {
    it('should return total usage for a project', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          total_in: 50000,
          total_out: 25000,
          total_cost: 0.5,
          total_calls: 20,
        }],
      });

      const since = new Date('2026-01-01');
      const until = new Date('2026-06-30');

      const result = await UsageLogger.getTotalUsage(1, since, until);

      expect(result.total_in).toBe(50000);
      expect(result.total_cost).toBe(0.5);
    });

    it('should return zeros if no usage found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [null] });

      const since = new Date('2026-01-01');
      const until = new Date('2026-06-30');

      const result = await UsageLogger.getTotalUsage(1, since, until);

      expect(result.total_in).toBe(0);
      expect(result.total_cost).toBe(0);
    });
  });

  describe('reportUsage', () => {
    it('should insert usage report with calculated cost', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}] });

      await UsageLogger.reportUsage(5, {
        provider_type: 'claude',
        model: 'claude-sonnet-4-20250514',
        tokens_in: 2000,
        tokens_out: 800,
        duration_ms: 3500,
        ticket_id: 42,
        project_id: 1,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO usage_logs'),
        [5, 'claude', 'claude-sonnet-4-20250514', 2000, 800, expect.any(Number), 3500, 42, 1]
      );

      const cost = calculateCost('claude-sonnet-4-20250514', 2000, 800);
      expect(pool.query.mock.calls[0][1][5]).toBeCloseTo(cost);
    });

    it('should throw error for missing required fields', async () => {
      await expect(
        UsageLogger.reportUsage(5, {
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          // tokens_out missing
        })
      ).rejects.toThrow('Missing required fields');
    });

    it('should handle optional fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}] });

      await UsageLogger.reportUsage(5, {
        provider_type: 'openai',
        model: 'gpt-4o',
        tokens_in: 500,
        tokens_out: 200,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO usage_logs'),
        [5, 'openai', 'gpt-4o', 500, 200, expect.any(Number), 0, null, null]
      );
    });
  });
});
