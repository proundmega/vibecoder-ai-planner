jest.mock('../services/HarnessUsageService', () => ({
  summarizeProject: jest.fn(),
}));

jest.mock('../services/HarnessBudgetService', () => ({
  getPolicy: jest.fn(),
}));

jest.mock('../services/HarnessRunService', () => ({
  listRunsForProject: jest.fn(),
}));

const HarnessUsageService = require('../services/HarnessUsageService');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessRunService = require('../services/HarnessRunService');
const HarnessDashboardService = require('../services/HarnessDashboardService');
const HarnessMetrics = require('../services/HarnessMetrics');

const RUN_AGGREGATE = {
  total: 10,
  succeeded: 6,
  failed: 2,
  deadLetter: 1,
  budgetExceeded: 0,
  running: 0,
  successRate: 0.6,
  durationSeconds: { p50: 120, p95: 600 },
};

const USAGE = {
  models: [{ model: 'gpt-4o', costUsd: 1.5 }],
  totals: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, costUsd: 1.5, toolCalls: 4 },
};

function policy(overrides = {}) {
  return {
    dailySpendUsd: 1.5,
    quotas: { dailyCostUsd: 20 },
    killSwitch: null,
    routing: { policy: 'free_then_paid' },
    limits: {},
    ...overrides,
  };
}

describe('HarnessDashboardService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    HarnessUsageService.summarizeProject.mockResolvedValue(USAGE);
    HarnessBudgetService.getPolicy.mockResolvedValue(policy());
    HarnessRunService.listRunsForProject.mockResolvedValue([
      { id: 'run-1', status: 'failed', ticket_title: 'Smoke' },
    ]);
    jest.spyOn(HarnessDashboardService, 'getRunAggregate').mockResolvedValue(RUN_AGGREGATE);
    jest.spyOn(HarnessDashboardService, 'getThroughput').mockResolvedValue([
      { day: '2026-11-01T00:00:00.000Z', runs: 3, succeeded: 2, failed: 1, budgetExceeded: 0 },
    ]);
    jest.spyOn(HarnessDashboardService, 'getStuckRuns').mockResolvedValue([]);
    jest.spyOn(HarnessDashboardService, 'getEventCounts').mockResolvedValue({
      'review.result': 2,
      'fix.requested': 1,
    });
    jest.spyOn(HarnessDashboardService, 'getToolFailures').mockResolvedValue(1);
    jest.spyOn(HarnessDashboardService, 'getSecretFlagged').mockResolvedValue(0);
    jest.spyOn(HarnessDashboardService, 'getRepeatedFailures').mockResolvedValue([]);
    jest.spyOn(HarnessDashboardService, 'getLargeDiffs').mockResolvedValue([]);
    jest.spyOn(HarnessDashboardService, 'getFailureWindow').mockResolvedValue({
      windowMinutes: 60, total: 4, failed: 1, failureRate: 0.25,
    });
  });

  it('returns runs, cost, review rounds and null merge metrics', async () => {
    const dashboard = await HarnessDashboardService.getDashboard(7, {
      since: '2026-11-01T00:00:00Z',
      until: '2026-11-07T00:00:00Z',
    });

    expect(dashboard.runs).toEqual(RUN_AGGREGATE);
    expect(dashboard.recentRuns).toEqual([
      { id: 'run-1', status: 'failed', ticket_title: 'Smoke' },
    ]);
    expect(dashboard.cost).toEqual(USAGE);
    expect(dashboard.review).toEqual({ reviewRounds: 2, fixRounds: 1 });
    expect(dashboard.toolCalls).toEqual({ total: 4, failed: 1 });
    expect(dashboard.merge).toBeNull();
    expect(dashboard.rollback).toBeNull();
    expect(dashboard.alerts).toEqual([]);
  });

  it('emits alerts for stuck runs, secret hits, large diffs and budget breach', async () => {
    HarnessDashboardService.getStuckRuns.mockResolvedValue([
      { id: 'run-1', stale_seconds: 1200 },
    ]);
    HarnessDashboardService.getSecretFlagged.mockResolvedValue(2);
    HarnessDashboardService.getLargeDiffs.mockResolvedValue([{ run_id: 'run-2' }]);
    HarnessDashboardService.getRepeatedFailures.mockResolvedValue([
      { ticket_id: 42, failures: 3 },
    ]);
    HarnessDashboardService.getRunAggregate.mockResolvedValue({
      ...RUN_AGGREGATE, budgetExceeded: 2,
    });
    HarnessBudgetService.getPolicy.mockResolvedValue(policy({
      dailySpendUsd: 21,
      quotas: { dailyCostUsd: 20 },
    }));

    const dashboard = await HarnessDashboardService.getDashboard(7, {});

    const codes = dashboard.alerts.map((alert) => alert.code);
    expect(codes).toEqual(expect.arrayContaining([
      'stuck_run',
      'repeated_failure',
      'budget_exceeded',
      'daily_budget_exhausted',
      'secret_pattern',
      'abnormal_diff_size',
    ]));
    const gauge = await HarnessMetrics.gauges.stuckRuns.get();
    expect(gauge.values[0].value).toBe(1);
  });

  it('alerts on a failure-rate spike only with a meaningful sample', async () => {
    HarnessDashboardService.getFailureWindow.mockResolvedValue({
      windowMinutes: 60, total: 4, failed: 4, failureRate: 1,
    });
    const small = await HarnessDashboardService.getDashboard(7, {});
    expect(small.alerts.find((a) => a.code === 'failure_rate_spike')).toBeUndefined();

    HarnessDashboardService.getFailureWindow.mockResolvedValue({
      windowMinutes: 60, total: 10, failed: 6, failureRate: 0.6,
    });
    const large = await HarnessDashboardService.getDashboard(7, {});
    expect(large.alerts.find((a) => a.code === 'failure_rate_spike')).toBeDefined();
  });

  it('rejects an invalid period', async () => {
    await expect(HarnessDashboardService.getDashboard(7, {
      since: '2026-11-08T00:00:00Z',
      until: '2026-11-07T00:00:00Z',
    })).rejects.toThrow('since must be before until');
  });
});
