const BillingService = require('../services/BillingService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
  },
}));

const { pool } = require('../db');

describe('BillingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('aggregateDailyBilling', () => {
    it('should aggregate usage logs into billing records', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { project_id: 1, total_cost: 0.5, total_in: 10000, total_out: 5000, total_calls: 5 },
          ],
        })
        .mockResolvedValueOnce({ rows: [{}] });

      const date = new Date('2026-06-10');
      const count = await BillingService.aggregateDailyBilling(date);

      expect(count).toBe(1);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProjectBilling', () => {
    it('should return billing records for a project and month', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            project_id: 1,
            billing_month: '2026-06-01',
            total_cost_usd: 5.50,
            total_tokens_in: 100000,
            total_tokens_out: 50000,
            total_calls: 50,
          },
        ],
      });

      const result = await BillingService.getProjectBilling(1, '2026-06-01');

      expect(result).toHaveLength(1);
      expect(result[0].total_cost_usd).toBe(5.50);
    });
  });

  describe('getProjectBillingRange', () => {
    it('should return billing records for a date range', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            billing_month: '2026-04-01',
            total_cost_usd: 3.25,
            total_tokens_in: 50000,
            total_tokens_out: 25000,
            total_calls: 25,
          },
          {
            billing_month: '2026-05-01',
            total_cost_usd: 4.75,
            total_tokens_in: 75000,
            total_tokens_out: 37500,
            total_calls: 37,
          },
        ],
      });

      const result = await BillingService.getProjectBillingRange(1, '2026-04-01', '2026-06-01');

      expect(result).toHaveLength(2);
    });
  });

  describe('getUserBilling', () => {
    it('should return billing for all user projects', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            project_id: 1,
            project_name: 'Test Project',
            billing_month: '2026-06-01',
            total_cost_usd: 5.50,
            total_tokens_in: 100000,
            total_tokens_out: 50000,
            total_calls: 50,
          },
        ],
      });

      const result = await BillingService.getUserBilling(1);

      expect(result).toHaveLength(1);
      expect(result[0].project_name).toBe('Test Project');
    });
  });

  describe('getUsageSince', () => {
    it('should return usage breakdown since a date', async () => {
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
      const result = await BillingService.getUsageSince(1, since);

      expect(result).toHaveLength(1);
      expect(result[0].provider_type).toBe('claude');
    });
  });
});
