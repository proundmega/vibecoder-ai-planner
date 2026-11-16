jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const { pool } = require('../db');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessMetrics = require('../services/HarnessMetrics');

function mockQueries({
  policies = [],
  prices = [],
  defaultPrice = null,
  spend = 0,
  killSwitch = null,
  projectRuns = 0,
  agentRuns = 0,
  reserved = 0,
  upserted = { id: 1 },
  killSwitchRow = { id: 1, scope: 'project', enabled: true },
  auditFails = false,
} = {}) {
  const impl = async (sql) => {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('FROM harness_budget_policies')) return { rows: policies };
    if (sql.includes('FROM model_prices')) {
      if (sql.includes("model = 'default'")) {
        return { rows: defaultPrice ? [defaultPrice] : [] };
      }
      return { rows: prices };
    }
    if (sql.includes('FROM harness_usage') && sql.includes('SUM(cost_usd)')) {
      return { rows: [{ cost: spend }] };
    }
    if (sql.includes('FROM harness_kill_switches')) {
      return { rows: killSwitch ? [killSwitch] : [] };
    }
    if (sql.includes('FROM harness_kill_switch_audit')) {
      return { rows: [] };
    }
    if (sql.includes('SUM(r.budget_reserved_usd)')) {
      return { rows: [{ reserved }] };
    }
    if (sql.includes('JOIN tickets') && sql.includes('COUNT(*)')) {
      return { rows: [{ count: projectRuns }] };
    }
    if (sql.includes('FROM harness_runs') && sql.includes('agent_id')) {
      return { rows: [{ count: agentRuns }] };
    }
    if (sql.includes('INSERT INTO harness_budget_policies')) {
      return { rows: [upserted] };
    }
    if (sql.includes('INSERT INTO harness_kill_switches')) {
      return { rows: [killSwitchRow] };
    }
    if (sql.includes('INSERT INTO harness_kill_switch_audit')) {
      if (auditFails) throw new Error('audit unavailable');
      return { rows: [{ id: 1 }] };
    }
    return { rows: [] };
  };
  pool.query.mockImplementation(impl);
  const client = {
    query: jest.fn(impl),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

const PRICE = {
  model: 'gpt-4o',
  input_per_million: 2.5,
  output_per_million: 10,
  cached_per_million: 1.25,
  effective_from: '2026-01-01T00:00:00Z',
};

describe('HarnessBudgetService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries();
  });

  describe('getPolicy', () => {
    it('returns conservative env defaults when no project row exists', async () => {
      mockQueries();

      const policy = await HarnessBudgetService.getPolicy(7);

      expect(policy.source).toBe('default');
      expect(policy.limits.maxDurationSeconds).toBe(45 * 60);
      expect(policy.limits.maxCostUsd).toBe(5);
      expect(policy.quotas.projectMaxConcurrentRuns).toBe(4);
      expect(policy.routing.policy).toBe('free_then_paid');
      expect(policy.prices).toHaveProperty('beam-free');
      expect(policy.killSwitch).toBeNull();
    });

    it('merges project and ticket overrides', async () => {
      mockQueries({
        policies: [
          {
            scope: 'project',
            scope_id: null,
            max_cost_usd: '12.5',
            daily_cost_usd: '40',
            routing_policy: 'paid_for_complex',
            free_model: 'beam-free',
            paid_model: 'gpt-4o',
            complexity_threshold: 5,
            warn_ratio: '0.75',
          },
          {
            scope: 'ticket',
            scope_id: 42,
            max_tool_calls: 12,
            max_cost_usd: null,
          },
        ],
        prices: [PRICE],
        spend: 1.25,
      });

      const policy = await HarnessBudgetService.getPolicy(7, { ticketId: 42 });

      expect(policy.source).toBe('project');
      expect(policy.limits.maxCostUsd).toBe(12.5);
      expect(policy.limits.maxToolCalls).toBe(12);
      expect(policy.limits.warnRatio).toBe(0.75);
      expect(policy.quotas.dailyCostUsd).toBe(40);
      expect(policy.routing.policy).toBe('paid_for_complex');
      expect(policy.dailySpendUsd).toBe(1.25);
      expect(policy.prices['gpt-4o'].outputPerMillion).toBe(10);
    });
  });

  describe('assertCanStart', () => {
    it('blocks starts when a kill switch is enabled', async () => {
      mockQueries({
        killSwitch: { scope: 'project', project_id: 7, enabled: true, reason: 'incident' },
      });

      await expect(HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9,
      })).rejects.toThrow('Harness kill switch is enabled: incident');
    });

    it('blocks starts beyond the retry cap', async () => {
      await expect(HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9, attempt: 4,
      })).rejects.toThrow('Harness retry limit reached');
    });

    it('blocks starts when the daily project budget is exhausted', async () => {
      mockQueries({ spend: 25 });
      await expect(HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9,
      })).rejects.toThrow('Harness daily project budget exhausted');
    });

    it('blocks starts at the project concurrency limit', async () => {
      mockQueries({ projectRuns: 4 });
      await expect(HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9,
      })).rejects.toThrow('Harness project concurrency limit reached');
    });

    it('blocks starts at the agent concurrency limit', async () => {
      mockQueries({ agentRuns: 1 });
      await expect(HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9,
      })).rejects.toThrow('Harness agent concurrency limit reached');
    });

    it('allocates the run cost cap from spend plus active reservations', async () => {
      mockQueries({
        spend: 8,
        reserved: 0,
        policies: [{ scope: 'project', daily_cost_usd: 10 }],
      });
      const first = await HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9,
      });
      expect(first.reservedCostUsd).toBe(2);

      mockQueries({
        spend: 8,
        reserved: 2,
        policies: [{ scope: 'project', daily_cost_usd: 10 }],
      });
      await expect(HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 43, agentId: 10,
      })).rejects.toThrow('Harness daily project budget is fully reserved');
    });

    it('treats dailyCostUsd=0 as unlimited', async () => {
      mockQueries({
        policies: [{ scope: 'project', daily_cost_usd: 0, max_cost_usd: 5 }],
      });
      const policy = await HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9,
      });
      expect(policy.quotas.dailyCostUsd).toBe(0);
      expect(policy.reservedCostUsd).toBe(5);
    });

    it('takes the project advisory lock and allows a compliant start', async () => {
      const policy = await HarnessBudgetService.assertCanStart({
        projectId: 7, ticketId: 42, agentId: 9, attempt: 1, lock: true,
      });

      expect(policy.projectId).toBe(7);
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1::int, $2::int)',
        [42038, 7]
      );
    });
  });

  describe('pricing', () => {
    it('prices input, output and cached tokens per million', async () => {
      mockQueries({ prices: [PRICE] });
      const cost = await HarnessBudgetService.computeCost({
        model: 'opencode-go/gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cachedTokens: 1_000_000,
      });
      expect(cost).toBe(2.5 + 5 + 1.25);
    });

    it('falls back to the default price for an unknown model', async () => {
      mockQueries({
        prices: [],
        defaultPrice: {
          model: 'default',
          input_per_million: 1,
          output_per_million: 3,
          cached_per_million: 0,
        },
      });
      const cost = await HarnessBudgetService.computeCost({
        model: 'not-in-the-table',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(cost).toBe(4);
    });
  });

  describe('policy and kill-switch writes', () => {
    it('rejects an unknown routing policy', async () => {
      await expect(HarnessBudgetService.upsertPolicy({
        projectId: 7,
        policy: { routingPolicy: 'most-expensive' },
      })).rejects.toThrow('routingPolicy must be one of');
    });

    it('rejects an out-of-range warn ratio', async () => {
      await expect(HarnessBudgetService.upsertPolicy({
        projectId: 7,
        policy: { warnRatio: 1.5 },
      })).rejects.toThrow('warnRatio must be greater than 0');
    });

    it('requires a scope id for a ticket override', async () => {
      await expect(HarnessBudgetService.upsertPolicy({
        projectId: 7, scope: 'ticket', policy: {},
      })).rejects.toThrow('scopeId must be a positive integer');
    });

    it('upserts the project policy', async () => {
      mockQueries({ upserted: { id: 3, project_id: 7 } });
      const row = await HarnessBudgetService.upsertPolicy({
        projectId: 7,
        policy: {
          maxCostUsd: 8,
          routingPolicy: 'free_only',
          warnRatio: 0.7,
        },
        updatedBy: 1,
      });
      expect(row.id).toBe(3);
      expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO harness_budget_policies');
    });

    it('sets and reports a project kill switch atomically with its audit row', async () => {
      const client = mockQueries({
        killSwitchRow: { scope: 'project', project_id: 7, enabled: true },
      });
      const row = await HarnessBudgetService.setKillSwitch({
        projectId: 7,
        enabled: true,
        reason: 'runaway cost',
        updatedBy: 1,
      });
      expect(row.scope).toBe('project');
      expect(client.query.mock.calls.some(
        (call) => String(call[0]).includes('INSERT INTO harness_kill_switch_audit')
      )).toBe(true);
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      const gauge = await HarnessMetrics.gauges.killSwitch.get();
      expect(gauge.values.find((v) => v.labels.scope === 'project').value).toBe(1);
    });

    it('rolls back the switch when the audit insert fails', async () => {
      const client = mockQueries({ auditFails: true });

      await expect(HarnessBudgetService.setKillSwitch({
        projectId: 7,
        enabled: true,
        reason: 'audit must be durable',
        updatedBy: 1,
      })).rejects.toThrow('audit unavailable');

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    });

    it('lists project and global kill-switch history', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ scope: 'global', enabled: true }],
      });
      const rows = await HarnessBudgetService.listKillSwitchAudit(7, { limit: 10 });
      expect(rows).toHaveLength(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("scope = 'global'");
      expect(sql).toContain('scope = \'project\'');
      expect(params).toEqual([7, 10]);
    });

    it('rejects a non-boolean kill switch value', async () => {
      await expect(HarnessBudgetService.setKillSwitch({
        projectId: 7, enabled: 'yes',
      })).rejects.toThrow('enabled must be a boolean');
    });
  });
});
