const billingController = require('../controllers/billingController');
const BillingService = require('../services/BillingService');
const Project = require('../models/project');

jest.mock('../services/BillingService', () => ({
  getProjectBilling: jest.fn(),
  getProjectBillingRange: jest.fn(),
  getUsageSince: jest.fn(),
  getUserBilling: jest.fn(),
}));
jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));

describe('Billing Controller', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      json: jest.fn(),
    };
    mockReq = {
      params: {},
      query: {},
      user: { userId: 1 },
    };
  });

  describe('getProjectBilling', () => {
    it('should return billing for a project by month', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      BillingService.getProjectBilling.mockResolvedValue([
        {
          project_id: 1,
          billing_month: '2026-06-01',
          total_cost_usd: 5.50,
          total_tokens_in: 100000,
          total_tokens_out: 50000,
          total_calls: 50,
        },
      ]);

      mockReq.params.id = '1';
      mockReq.query = { month: '2026-06-01' };

      await billingController.getProjectBilling(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            billing_month: '2026-06-01',
            total_cost_usd: 5.50,
          }),
        ]),
      });
    });

    it('should return billing for a date range', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      BillingService.getProjectBillingRange.mockResolvedValue([
        {
          billing_month: '2026-04-01',
          total_cost_usd: 3.25,
          total_tokens_in: 50000,
          total_tokens_out: 25000,
          total_calls: 25,
        },
      ]);

      mockReq.params.id = '1';
      mockReq.query = { start: '2026-04-01', end: '2026-06-01' };

      await billingController.getProjectBilling(mockReq, mockRes, nextFn);

      expect(BillingService.getProjectBillingRange).toHaveBeenCalledWith(
        "1", '2026-04-01', '2026-06-01'
      );
    });

    it('should return usage since 90 days ago if no params', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      BillingService.getUsageSince.mockResolvedValue([
        {
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          total_cost: 0.105,
          total_calls: 5,
        },
      ]);

      mockReq.params.id = '1';

      await billingController.getProjectBilling(mockReq, mockRes, nextFn);

      expect(BillingService.getUsageSince).toHaveBeenCalledWith("1", expect.any(Date));
    });
  });

  describe('getUserBilling', () => {
    it('should return billing for all user projects', async () => {
      BillingService.getUserBilling.mockResolvedValue([
        {
          project_id: 1,
          project_name: 'Test Project',
          billing_month: '2026-06-01',
          total_cost_usd: 5.50,
        },
      ]);

      await billingController.getUserBilling(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            project_name: 'Test Project',
          }),
        ]),
      });
    });
  });
});
