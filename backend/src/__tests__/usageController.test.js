const usageController = require('../controllers/usageController');
const UsageLogger = require('../services/UsageLogger');
const Project = require('../models/project');

jest.mock('../services/UsageLogger');
jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));

describe('Usage Controller', () => {
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

  describe('getProjectUsage', () => {
    it('should return project usage with defaults (last 30 days)', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      UsageLogger.getProjectUsage.mockResolvedValue([]);
      UsageLogger.getTotalUsage.mockResolvedValue({
        total_in: 0,
        total_out: 0,
        total_cost: 0,
        total_calls: 0,
      });

      mockReq.params.id = '1';

      await usageController.getProjectUsage(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          breakdown: [],
          totals: expect.objectContaining({
            totalCost: 0,
            totalCalls: 0,
          }),
        }),
      });
    });

    it('should return project usage with custom date range', async () => {
      Project.findById.mockResolvedValue({ id: 1 });
      UsageLogger.getProjectUsage.mockResolvedValue([
        {
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          total_in: 10000,
          total_out: 5000,
          total_cost: 0.105,
          total_calls: 5,
        },
      ]);
      UsageLogger.getTotalUsage.mockResolvedValue({
        total_in: 10000,
        total_out: 5000,
        total_cost: 0.105,
        total_calls: 5,
      });

      mockReq.params.id = '1';
      mockReq.query = { since: '2026-01-01', until: '2026-06-30' };

      await usageController.getProjectUsage(mockReq, mockRes, nextFn);

      expect(UsageLogger.getProjectUsage).toHaveBeenCalledWith(
        "1",
        expect.any(Date),
        expect.any(Date)
      );
    });
  });

  describe('getUserUsage', () => {
    it('should return user usage', async () => {
      UsageLogger.getUserUsage.mockResolvedValue([
        {
          project_name: 'Test Project',
          provider_type: 'openai',
          model: 'gpt-4o',
          total_cost: 0.05,
          total_calls: 3,
        },
      ]);

      mockReq.query = { since: '2026-01-01', until: '2026-06-30' };

      await usageController.getUserUsage(mockReq, mockRes, nextFn);

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

  describe('getModelPricing', () => {
    it('should return all model pricing', async () => {
      await usageController.getModelPricing(mockReq, mockRes, nextFn);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({
              model: 'gpt-4o',
              pricing: expect.objectContaining({
                input: 0.0025,
                output: 0.01,
              }),
            }),
          ]),
        }),
      });
    });
  });
});
