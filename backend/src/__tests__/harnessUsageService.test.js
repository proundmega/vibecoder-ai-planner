jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/HarnessRunService', () => ({
  getRun: jest.fn(),
}));

jest.mock('../services/HarnessBudgetService', () => ({
  computeCost: jest.fn().mockResolvedValue(0.42),
}));

const { pool } = require('../db');
const HarnessRunService = require('../services/HarnessRunService');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessUsageService = require('../services/HarnessUsageService');
const HarnessMetrics = require('../services/HarnessMetrics');

const RUN_ID = '11111111-1111-4111-8111-111111111111';

const RUN = {
  id: RUN_ID,
  ticket_id: 42,
  project_id: 7,
  agent_id: 9,
};

describe('HarnessUsageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    HarnessRunService.getRun.mockResolvedValue(RUN);
    HarnessBudgetService.computeCost.mockResolvedValue(0.42);
  });

  describe('recordUsage', () => {
    it('stores a cumulative snapshot with backend-priced cost', async () => {
      const row = { id: 'usage-1', run_id: RUN_ID, model: 'gpt-4o' };
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [row] });

      const result = await HarnessUsageService.recordUsage({
        runId: RUN_ID,
        agentId: 9,
        model: 'gpt-4o',
        promptVersion: 'v1',
        routingReason: 'small ticket',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 10,
        toolCalls: 3,
        durationMs: 1200,
      });

      expect(result).toEqual(row);
      expect(HarnessBudgetService.computeCost).toHaveBeenCalledWith({
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 10,
      });
      const [sql, params] = pool.query.mock.calls[1];
      expect(sql).toContain('ON CONFLICT (run_id, model)');
      expect(sql).toContain('GREATEST');
      expect(params.slice(0, 8)).toEqual([
        RUN_ID, 42, 7, 9, 'gpt-4o', 'v1', null, 'small ticket',
      ]);
      expect(params[8]).toBe(100);
      expect(params[11]).toBe(0.42);
    });

    it('records only usage deltas in Prometheus metrics', async () => {
      const recordUsage = jest.spyOn(HarnessMetrics, 'recordUsage')
        .mockImplementation(() => {});
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            input_tokens: '80',
            output_tokens: '40',
            cached_tokens: '0',
            cost_usd: '0.30',
            tool_calls: '2',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: 'usage-1' }] });

      await HarnessUsageService.recordUsage({
        runId: RUN_ID,
        agentId: 9,
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        toolCalls: 3,
        durationMs: 1200,
      });

      expect(recordUsage).toHaveBeenCalledWith({
        inputTokens: 20,
        outputTokens: 10,
        costUsd: 0.12,
      });
      recordUsage.mockRestore();
    });

    it('rejects usage for another agent’s run', async () => {
      await expect(HarnessUsageService.recordUsage({
        runId: RUN_ID,
        agentId: 10,
        model: 'gpt-4o',
      })).rejects.toThrow('Harness run belongs to another agent');
    });

    it('rejects negative counters', async () => {
      await expect(HarnessUsageService.recordUsage({
        runId: RUN_ID,
        agentId: 9,
        model: 'gpt-4o',
        inputTokens: -1,
      })).rejects.toThrow('inputTokens must be a non-negative integer');
    });
  });

  describe('queries', () => {
    it('lists run usage per model', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ model: 'gpt-4o' }] });
      const rows = await HarnessUsageService.listForRun(RUN_ID);
      expect(rows).toHaveLength(1);
      expect(pool.query.mock.calls[0][0]).toContain('ORDER BY model ASC');
    });

    it('sums run totals', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          input_tokens: '10',
          output_tokens: '20',
          cached_tokens: '5',
          cost_usd: '0.5',
          tool_calls: '2',
          duration_ms: '100',
        }],
      });
      const totals = await HarnessUsageService.getRunTotals(RUN_ID);
      expect(totals).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        cachedTokens: 5,
        costUsd: 0.5,
        toolCalls: 2,
        durationMs: 100,
      });
    });

    it('summarises project usage by model', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            model: 'gpt-4o',
            input_tokens: '100',
            output_tokens: '50',
            cached_tokens: '0',
            cost_usd: '1.5',
            tool_calls: '4',
            runs: '2',
          },
          {
            model: 'beam-free',
            input_tokens: '10',
            output_tokens: '5',
            cached_tokens: '0',
            cost_usd: '0',
            tool_calls: '1',
            runs: '1',
          },
        ],
      });

      const summary = await HarnessUsageService.summarizeProject(7, {
        since: '2026-11-01T00:00:00Z',
      });

      expect(summary.models).toHaveLength(2);
      expect(summary.totals).toEqual({
        inputTokens: 110,
        outputTokens: 55,
        cachedTokens: 0,
        costUsd: 1.5,
        toolCalls: 5,
      });
    });
  });

  describe('billing flush', () => {
    it('flushes once per run and model', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] });

      const result = await HarnessUsageService.flushRunToUsageLogs(RUN_ID);

      expect(result.inserted).toBe(2);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('INSERT INTO usage_logs');
      expect(sql).toContain("'harness'");
      expect(sql).toContain("existing.metadata->>'run_id'");
    });

    it('skips a run that no longer exists', async () => {
      HarnessRunService.getRun.mockRejectedValueOnce(new Error('not found'));
      const result = await HarnessUsageService.flushRunToUsageLogs(RUN_ID);
      expect(result.inserted).toBe(0);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
