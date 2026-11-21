const { pool } = require('../db');
const HarnessMetrics = require('./HarnessMetrics');
const {
  ValidationError,
  ConflictError,
  NotFoundError,
} = require('../errors/HttpError');

/**
 * Harness budget, quota, routing and kill-switch policy (fg-38).
 *
 * The supervisor meters locally; this service is the authoritative policy and
 * the shared quota gate. Starts are serialised per project with a transaction
 * advisory lock so two concurrent agents cannot both claim the last slot.
 */

const ROUTING_POLICIES = Object.freeze([
  'free_only',
  'free_then_paid',
  'paid_for_complex',
  'paid_only',
]);
const POLICY_SCOPES = Object.freeze(['project', 'ticket', 'agent']);
const PROJECT_LOCK_CLASS = 42038;

function envInt(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaults() {
  return {
    maxDurationSeconds: envInt('HARNESS_DEFAULT_MAX_DURATION_MINUTES', 45) * 60,
    maxInputTokens: envInt('HARNESS_DEFAULT_MAX_INPUT_TOKENS', 1_200_000),
    maxOutputTokens: envInt('HARNESS_DEFAULT_MAX_OUTPUT_TOKENS', 300_000),
    maxCostUsd: envNumber('HARNESS_DEFAULT_MAX_COST_USD', 5),
    maxToolCalls: envInt('HARNESS_DEFAULT_MAX_TOOL_CALLS', 100),
    maxRetries: envInt('HARNESS_DEFAULT_MAX_RETRIES', 2),
    dailyCostUsd: envNumber('HARNESS_DEFAULT_DAILY_COST_USD', 20),
    projectMaxConcurrentRuns: envInt('HARNESS_DEFAULT_PROJECT_MAX_CONCURRENT_RUNS', 4),
    agentMaxConcurrentRuns: envInt('HARNESS_DEFAULT_AGENT_MAX_CONCURRENT_RUNS', 1),
    warnRatio: envNumber('HARNESS_DEFAULT_WARN_RATIO', 0.8) || 0.8,
    routingPolicy: process.env.HARNESS_DEFAULT_ROUTING_POLICY
      && ROUTING_POLICIES.includes(process.env.HARNESS_DEFAULT_ROUTING_POLICY)
      ? process.env.HARNESS_DEFAULT_ROUTING_POLICY
      : 'free_then_paid',
    freeModel: process.env.HARNESS_FREE_MODEL || 'beam-free',
    paidModel: process.env.HARNESS_PAID_MODEL || null,
    complexityThreshold: envInt('HARNESS_COMPLEXITY_THRESHOLD', 3),
  };
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function optionalNonNegative(value, field, integer = true) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (integer && (!Number.isInteger(parsed) || parsed < 0)) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  if (!integer && (!Number.isFinite(parsed) || parsed < 0)) {
    throw new ValidationError(`${field} must be a non-negative number`);
  }
  return parsed;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseModel(model) {
  if (typeof model !== 'string' || model.trim() === '') return 'default';
  const trimmed = model.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 && slash < trimmed.length - 1
    ? trimmed.slice(slash + 1)
    : trimmed;
}

function roundCost(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

class HarnessBudgetService {
  /**
   * Resolve the effective policy. A project row is the base; a ticket/runtime
   * row (stored with the legacy `agent` scope name) overrides only the fields it sets. Missing rows fall back to env
   * defaults, so enforcement is never disabled by missing configuration.
   */
  async getPolicy(projectId, { ticketId = null, agentId = null, client = pool, extraModels = [] } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const result = await client.query(
      'SELECT * FROM harness_budget_policies WHERE project_id = $1',
      [id]
    );
    const rows = result.rows || [];
    const projectRow = rows.find((row) => row.scope === 'project') || null;
    const ticketRow = ticketId === null
      ? null
      : rows.find((row) => row.scope === 'ticket' && String(row.scope_id) === String(ticketId));
    const agentRow = agentId === null
      ? null
      : rows.find((row) => row.scope === 'agent' && String(row.scope_id) === String(agentId));

    const base = defaults();
    const merged = { ...base };
    for (const row of [projectRow, ticketRow, agentRow]) {
      if (!row) continue;
      const mapping = {
        maxDurationSeconds: row.max_duration_seconds,
        maxInputTokens: row.max_input_tokens,
        maxOutputTokens: row.max_output_tokens,
        maxCostUsd: row.max_cost_usd,
        maxToolCalls: row.max_tool_calls,
        maxRetries: row.max_retries,
        dailyCostUsd: row.daily_cost_usd,
        projectMaxConcurrentRuns: row.project_max_concurrent_runs,
        agentMaxConcurrentRuns: row.agent_max_concurrent_runs,
        warnRatio: row.warn_ratio,
        routingPolicy: row.routing_policy,
        freeModel: row.free_model,
        paidModel: row.paid_model,
        complexityThreshold: row.complexity_threshold,
      };
      for (const [key, value] of Object.entries(mapping)) {
        if (value !== null && value !== undefined) {
          merged[key] = key === 'maxCostUsd'
            || key === 'dailyCostUsd'
            || key === 'warnRatio'
            ? numberOrNull(value)
            : value;
        }
      }
    }

    const prices = await this.getModelPrices({
      models: [...new Set([
        merged.freeModel,
        merged.paidModel,
        ...(Array.isArray(extraModels) ? extraModels : []),
      ].filter(Boolean))],
      client,
    });
    const dailySpendUsd = await this.getDailySpend(id, client);
    const killSwitch = await this.getKillSwitch(id, client);
    HarnessMetrics.setKillSwitch('global', Boolean(killSwitch && killSwitch.scope === 'global'));
    HarnessMetrics.setKillSwitch('project', Boolean(killSwitch && killSwitch.scope === 'project'));

    return {
      projectId: id,
      source: projectRow ? 'project' : 'default',
      limits: {
        maxDurationSeconds: Number(merged.maxDurationSeconds),
        maxInputTokens: Number(merged.maxInputTokens),
        maxOutputTokens: Number(merged.maxOutputTokens),
        maxCostUsd: Number(merged.maxCostUsd),
        maxToolCalls: Number(merged.maxToolCalls),
        maxRetries: Number(merged.maxRetries),
        warnRatio: Number(merged.warnRatio),
      },
      quotas: {
        dailyCostUsd: Number(merged.dailyCostUsd),
        projectMaxConcurrentRuns: Number(merged.projectMaxConcurrentRuns),
        agentMaxConcurrentRuns: Number(merged.agentMaxConcurrentRuns),
      },
      routing: {
        policy: ROUTING_POLICIES.includes(merged.routingPolicy)
          ? merged.routingPolicy
          : base.routingPolicy,
        freeModel: merged.freeModel || base.freeModel,
        paidModel: merged.paidModel || base.paidModel,
        complexityThreshold: Number(merged.complexityThreshold),
      },
      prices,
      dailySpendUsd,
      killSwitch,
    };
  }

  async getModelPrices({ models = null, client = pool } = {}) {
    const params = [];
    let filter = '';
    if (Array.isArray(models) && models.length > 0) {
      params.push(models.map(normaliseModel));
      filter = 'AND model = ANY($1::text[])';
    }
    const result = await client.query(
      `SELECT DISTINCT ON (model) model, input_per_million, output_per_million,
              cached_per_million, effective_from
       FROM model_prices
       WHERE effective_from <= NOW() ${filter}
       ORDER BY model, effective_from DESC`,
      params
    );
    const prices = {};
    for (const row of result.rows || []) {
      prices[row.model] = {
        inputPerMillion: Number(row.input_per_million),
        outputPerMillion: Number(row.output_per_million),
        cachedPerMillion: Number(row.cached_per_million),
        effectiveFrom: row.effective_from,
      };
    }
    if (Array.isArray(models) && models.length > 0) {
      const fallback = await client.query(
        `SELECT DISTINCT ON (model) model, input_per_million, output_per_million,
                cached_per_million, effective_from
         FROM model_prices
         WHERE model = 'default' AND effective_from <= NOW()
         ORDER BY model, effective_from DESC`
      );
      const defaultRow = (fallback.rows || [])[0];
      const defaultPrice = defaultRow
        ? {
          inputPerMillion: Number(defaultRow.input_per_million),
          outputPerMillion: Number(defaultRow.output_per_million),
          cachedPerMillion: Number(defaultRow.cached_per_million),
          effectiveFrom: defaultRow.effective_from,
        }
        : { inputPerMillion: 0, outputPerMillion: 0, cachedPerMillion: 0 };
      for (const model of models) {
        const key = normaliseModel(model);
        if (!prices[key]) prices[key] = defaultPrice;
      }
    }
    return prices;
  }

  async computeCost({ model, inputTokens = 0, outputTokens = 0, cachedTokens = 0, client = pool }) {
    const key = normaliseModel(model);
    const prices = await this.getModelPrices({ models: [key], client });
    const price = prices[key] || { inputPerMillion: 0, outputPerMillion: 0, cachedPerMillion: 0 };
    const cost = (Number(inputTokens) / 1_000_000) * price.inputPerMillion
      + (Number(outputTokens) / 1_000_000) * price.outputPerMillion
      + (Number(cachedTokens) / 1_000_000) * price.cachedPerMillion;
    return roundCost(cost);
  }

  async getDailySpend(projectId, client = pool) {
    const result = await client.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS cost
       FROM harness_usage
       WHERE project_id = $1 AND created_at >= date_trunc('day', NOW())`,
      [positiveInteger(projectId, 'projectId')]
    );
    return Number(result.rows?.[0]?.cost || 0);
  }

  async getKillSwitch(projectId, client = pool) {
    const params = [];
    let clause = "scope = 'global'";
    if (projectId !== null && projectId !== undefined) {
      params.push(positiveInteger(projectId, 'projectId'));
      clause = `(scope = 'global' OR (scope = 'project' AND project_id = $1))`;
    }
    const result = await client.query(
      `SELECT * FROM harness_kill_switches
       WHERE enabled = TRUE AND ${clause}
       ORDER BY CASE WHEN scope = 'global' THEN 0 ELSE 1 END
       LIMIT 1`,
      params
    );
    return result.rows?.[0] || null;
  }

  /**
   * Shared quota gate. Called inside the startRun transaction (the advisory
   * lock is transaction-scoped) and must fail closed on any error.
   */
  async assertCanStart({
    projectId,
    ticketId,
    runtimeId = null,
    attempt = 1,
    client = pool,
    lock = false,
  } = {}) {
    const project = positiveInteger(projectId, 'projectId');
    positiveInteger(ticketId, 'ticketId');
    const hasRuntime = runtimeId !== null && runtimeId !== undefined;
    if (!hasRuntime) {
      throw new ValidationError('runtimeId is required');
    }
    const normalisedRuntimeId = positiveInteger(runtimeId, 'runtimeId');
    const normalisedAttempt = positiveInteger(attempt, 'attempt');

    if (lock) {
      await client.query(
        'SELECT pg_advisory_xact_lock($1::int, $2::int)',
        [PROJECT_LOCK_CLASS, project]
      );
    }

    const killSwitch = await this.getKillSwitch(project, client);
    if (killSwitch) {
      throw new ConflictError(
        `Harness kill switch is enabled${killSwitch.reason ? `: ${killSwitch.reason}` : ''}`
      );
    }

    const policy = await this.getPolicy(project, {
      ticketId,
      agentId: normalisedRuntimeId,
      client,
    });
    if (normalisedAttempt > Number(policy.limits.maxRetries) + 1) {
      throw new ConflictError(
        `Harness retry limit reached (${policy.limits.maxRetries} retries)`
      );
    }

    const activeTicketRun = await client.query(
      `SELECT 1 FROM harness_runs
       WHERE ticket_id = $1 AND status = 'running'
       LIMIT 1`,
      [positiveInteger(ticketId, 'ticketId')]
    );
    if (activeTicketRun.rows.length > 0) {
      throw new ConflictError('Ticket already has an active harness run');
    }

    if (Number(policy.quotas.dailyCostUsd) > 0
      && policy.dailySpendUsd >= Number(policy.quotas.dailyCostUsd)) {
      throw new ConflictError(
        `Harness daily project budget exhausted (${policy.dailySpendUsd.toFixed(2)} / `
          + `${Number(policy.quotas.dailyCostUsd).toFixed(2)} USD)`
      );
    }

    let reservedCostUsd = Number(policy.limits.maxCostUsd);
    const dailyLimit = Number(policy.quotas.dailyCostUsd);
    if (dailyLimit > 0) {
      const reservedResult = await client.query(
        `SELECT COALESCE(SUM(r.budget_reserved_usd), 0) AS reserved
         FROM harness_runs r
         JOIN tickets t ON t.id = r.ticket_id
         WHERE COALESCE(r.project_id, t.project_id) = $1 AND r.status = 'running'`,
        [project]
      );
      const reserved = Number(reservedResult.rows?.[0]?.reserved || 0);
      const available = dailyLimit - policy.dailySpendUsd - reserved;
      if (available <= 0) {
        throw new ConflictError(
          `Harness daily project budget is fully reserved `
            + `(${reserved.toFixed(2)} reserved / ${dailyLimit.toFixed(2)} USD)`
        );
      }
      const runCap = Number(policy.limits.maxCostUsd) > 0
        ? Number(policy.limits.maxCostUsd)
        : available;
      reservedCostUsd = Math.min(runCap, available);
    }

    const projectRuns = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM harness_runs r
       JOIN tickets t ON t.id = r.ticket_id
       WHERE COALESCE(r.project_id, t.project_id) = $1 AND r.status = 'running'`,
      [project]
    );
    if (Number(projectRuns.rows?.[0]?.count || 0) >= Number(policy.quotas.projectMaxConcurrentRuns)) {
      throw new ConflictError(
        `Harness project concurrency limit reached (${policy.quotas.projectMaxConcurrentRuns})`
      );
    }

    const agentRuns = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM harness_runs
       WHERE runtime_id = $1 AND status = 'running'`,
      [normalisedRuntimeId]
    );
    if (Number(agentRuns.rows?.[0]?.count || 0) >= Number(policy.quotas.agentMaxConcurrentRuns)) {
      throw new ConflictError(
        `Harness agent concurrency limit reached (${policy.quotas.agentMaxConcurrentRuns})`
      );
    }

    return { ...policy, reservedCostUsd };
  }

  /**
   * Upsert a policy. Omitted fields preserve the existing value on update and
   * fall back to the column default on insert; this keeps partial API updates
   * from disabling limits or resetting routing accidentally.
   */
  async upsertPolicy({
    projectId,
    scope = 'project',
    scopeId = null,
    policy = {},
    updatedBy = null,
  } = {}) {
    const project = positiveInteger(projectId, 'projectId');
    if (!POLICY_SCOPES.includes(scope)) {
      throw new ValidationError(`scope must be one of: ${POLICY_SCOPES.join(', ')}`);
    }
    const normalizedScopeId = scope === 'project'
      ? null
      : positiveInteger(scopeId, 'scopeId');
    if (policy.routingPolicy && !ROUTING_POLICIES.includes(policy.routingPolicy)) {
      throw new ValidationError(
        `routingPolicy must be one of: ${ROUTING_POLICIES.join(', ')}`
      );
    }
    const warnRatio = policy.warnRatio === undefined
      ? null
      : Number(policy.warnRatio);
    if (warnRatio !== null && (!Number.isFinite(warnRatio) || warnRatio <= 0 || warnRatio > 1)) {
      throw new ValidationError('warnRatio must be greater than 0 and at most 1');
    }

    const fields = {
      max_duration_seconds: optionalNonNegative(policy.maxDurationSeconds, 'maxDurationSeconds'),
      max_input_tokens: optionalNonNegative(policy.maxInputTokens, 'maxInputTokens'),
      max_output_tokens: optionalNonNegative(policy.maxOutputTokens, 'maxOutputTokens'),
      max_cost_usd: optionalNonNegative(policy.maxCostUsd, 'maxCostUsd', false),
      max_tool_calls: optionalNonNegative(policy.maxToolCalls, 'maxToolCalls'),
      max_retries: optionalNonNegative(policy.maxRetries, 'maxRetries'),
      daily_cost_usd: optionalNonNegative(policy.dailyCostUsd, 'dailyCostUsd', false),
      project_max_concurrent_runs: optionalNonNegative(
        policy.projectMaxConcurrentRuns, 'projectMaxConcurrentRuns'),
      agent_max_concurrent_runs: optionalNonNegative(
        policy.agentMaxConcurrentRuns, 'agentMaxConcurrentRuns'),
      warn_ratio: warnRatio,
      routing_policy: policy.routingPolicy || null,
      free_model: policy.freeModel === undefined ? null : (policy.freeModel || null),
      paid_model: policy.paidModel === undefined ? null : (policy.paidModel || null),
      clear_free_model: policy.freeModel === null || policy.freeModel === '',
      clear_paid_model: policy.paidModel === null || policy.paidModel === '',
      complexity_threshold: optionalNonNegative(
        policy.complexityThreshold, 'complexityThreshold'),
    };

    const result = await pool.query(
      `INSERT INTO harness_budget_policies
         (project_id, scope, scope_id, max_duration_seconds, max_input_tokens,
          max_output_tokens, max_cost_usd, max_tool_calls, max_retries,
          daily_cost_usd, project_max_concurrent_runs, agent_max_concurrent_runs,
          warn_ratio, routing_policy, free_model, paid_model, complexity_threshold,
          updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               COALESCE($13, 0.8), COALESCE($14, 'free_then_paid'), $15, $16,
               COALESCE($17, 3), $18, NOW())
       ON CONFLICT (project_id, scope, (COALESCE(scope_id, 0))) DO UPDATE
       SET max_duration_seconds = COALESCE($4, harness_budget_policies.max_duration_seconds),
           max_input_tokens = COALESCE($5, harness_budget_policies.max_input_tokens),
           max_output_tokens = COALESCE($6, harness_budget_policies.max_output_tokens),
           max_cost_usd = COALESCE($7, harness_budget_policies.max_cost_usd),
           max_tool_calls = COALESCE($8, harness_budget_policies.max_tool_calls),
           max_retries = COALESCE($9, harness_budget_policies.max_retries),
           daily_cost_usd = COALESCE($10, harness_budget_policies.daily_cost_usd),
           project_max_concurrent_runs = COALESCE(
             $11, harness_budget_policies.project_max_concurrent_runs),
           agent_max_concurrent_runs = COALESCE(
             $12, harness_budget_policies.agent_max_concurrent_runs),
           warn_ratio = COALESCE($13, harness_budget_policies.warn_ratio),
           routing_policy = COALESCE($14, harness_budget_policies.routing_policy),
           free_model = CASE WHEN $19 THEN NULL
                             ELSE COALESCE($15, harness_budget_policies.free_model) END,
           paid_model = CASE WHEN $20 THEN NULL
                             ELSE COALESCE($16, harness_budget_policies.paid_model) END,
           complexity_threshold = COALESCE(
             $17, harness_budget_policies.complexity_threshold),
           updated_by = COALESCE($18, harness_budget_policies.updated_by),
           updated_at = NOW()
       RETURNING *`,
      [
        project,
        scope,
        normalizedScopeId,
        fields.max_duration_seconds,
        fields.max_input_tokens,
        fields.max_output_tokens,
        fields.max_cost_usd,
        fields.max_tool_calls,
        fields.max_retries,
        fields.daily_cost_usd,
        fields.project_max_concurrent_runs,
        fields.agent_max_concurrent_runs,
        fields.warn_ratio,
        fields.routing_policy,
        fields.free_model,
        fields.paid_model,
        fields.complexity_threshold,
        updatedBy,
        fields.clear_free_model,
        fields.clear_paid_model,
      ]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Budget policy could not be saved');
    }
    return result.rows[0];
  }

  async setKillSwitch({
    projectId = null,
    enabled = true,
    reason = null,
    updatedBy = null,
  } = {}) {
    const scope = projectId === null || projectId === undefined ? 'global' : 'project';
    const project = scope === 'project' ? positiveInteger(projectId, 'projectId') : null;
    if (typeof enabled !== 'boolean') {
      throw new ValidationError('enabled must be a boolean');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO harness_kill_switches (scope, project_id, enabled, reason, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (scope, (COALESCE(project_id, 0))) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             reason = EXCLUDED.reason,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
         RETURNING *`,
        [scope, project, enabled, reason, updatedBy]
      );
      await this.recordKillSwitchAudit({
        scope,
        projectId: project,
        enabled,
        reason,
        actorId: updatedBy,
      }, client);
      await client.query('COMMIT');
      HarnessMetrics.setKillSwitch(scope, enabled);
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordKillSwitchAudit({
    scope,
    projectId = null,
    enabled,
    reason = null,
    actorId = null,
  }, client = pool) {
    const result = await client.query(
      `INSERT INTO harness_kill_switch_audit
         (scope, project_id, enabled, reason, actor_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [scope, projectId, enabled, reason, actorId]
    );
    return result.rows[0];
  }

  async listKillSwitchAudit(projectId, { limit = 50 } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new ValidationError('limit must be an integer between 1 and 200');
    }
    const result = await pool.query(
      `SELECT * FROM harness_kill_switch_audit
       WHERE scope = 'global'
          OR (scope = 'project' AND project_id = $1)
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [id, parsedLimit]
    );
    return result.rows;
  }
}

const instance = new HarnessBudgetService();
module.exports = instance;
module.exports.HarnessBudgetService = HarnessBudgetService;
module.exports.ROUTING_POLICIES = ROUTING_POLICIES;
module.exports.POLICY_SCOPES = POLICY_SCOPES;
module.exports.normaliseModel = normaliseModel;
module.exports.defaults = defaults;
