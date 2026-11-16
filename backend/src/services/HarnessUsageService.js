const { pool } = require('../db');
const HarnessRunService = require('./HarnessRunService');
const HarnessBudgetService = require('./HarnessBudgetService');
const HarnessMetrics = require('./HarnessMetrics');
const {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} = require('../errors/HttpError');
const logger = require('../utils/logger');

/**
 * Harness usage attribution (fg-38 FR1/FR2/FR8, fg-41 cost dashboards).
 *
 * The supervisor reports cumulative snapshots per run/model. The upsert keeps
 * the greatest value, so retried or out-of-order reports cannot double-count
 * and a crash leaves the last reported progress durable. At run finish the
 * aggregate is flushed once into usage_logs for the existing billing path.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, field, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function boundedString(value, field, max = 200) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  return value.trim().slice(0, max);
}

class HarnessUsageService {
  async recordUsage({
    runId,
    agentId,
    model,
    promptVersion = null,
    configHash = null,
    routingReason = null,
    inputTokens = 0,
    outputTokens = 0,
    cachedTokens = 0,
    toolCalls = 0,
    durationMs = 0,
  } = {}) {
    const id = requiredUuid(runId, 'runId');
    const normalisedAgentId = positiveInteger(agentId, 'agentId');
    const normalisedModel = boundedString(model, 'model', 200);
    if (!normalisedModel) {
      throw new ValidationError('model is required');
    }

    const run = await HarnessRunService.getRun(id);
    if (String(run.agent_id) !== String(normalisedAgentId)) {
      throw new ForbiddenError('Harness run belongs to another agent');
    }

    const input = nonNegativeInteger(inputTokens, 'inputTokens');
    const output = nonNegativeInteger(outputTokens, 'outputTokens');
    const cached = nonNegativeInteger(cachedTokens, 'cachedTokens');
    const tools = nonNegativeInteger(toolCalls, 'toolCalls');
    const duration = nonNegativeInteger(durationMs, 'durationMs');
    const costUsd = await HarnessBudgetService.computeCost({
      model: normalisedModel,
      inputTokens: input,
      outputTokens: output,
      cachedTokens: cached,
    });

    let projectId = run.project_id || null;
    if (!projectId && run.ticket_id) {
      const ticket = await pool.query(
        'SELECT project_id FROM tickets WHERE id = $1',
        [run.ticket_id]
      );
      projectId = ticket.rows?.[0]?.project_id || null;
    }

    const previousResult = await pool.query(
      `SELECT input_tokens, output_tokens, cached_tokens, cost_usd, tool_calls
       FROM harness_usage
       WHERE run_id = $1 AND model = $2`,
      [id, normalisedModel]
    );
    const previous = previousResult.rows?.[0] || {};
    const inputDelta = Math.max(0, input - Number(previous.input_tokens || 0));
    const outputDelta = Math.max(0, output - Number(previous.output_tokens || 0));
    const costDelta = Math.max(0, costUsd - Number(previous.cost_usd || 0));

    const result = await pool.query(
      `INSERT INTO harness_usage
         (run_id, ticket_id, project_id, agent_id, model, prompt_version,
          config_hash, routing_reason, input_tokens, output_tokens,
          cached_tokens, cost_usd, tool_calls, duration_ms, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       ON CONFLICT (run_id, model) WHERE run_id IS NOT NULL DO UPDATE
       SET input_tokens = GREATEST(harness_usage.input_tokens, EXCLUDED.input_tokens),
           output_tokens = GREATEST(harness_usage.output_tokens, EXCLUDED.output_tokens),
           cached_tokens = GREATEST(harness_usage.cached_tokens, EXCLUDED.cached_tokens),
           cost_usd = GREATEST(harness_usage.cost_usd, EXCLUDED.cost_usd),
           tool_calls = GREATEST(harness_usage.tool_calls, EXCLUDED.tool_calls),
           duration_ms = GREATEST(harness_usage.duration_ms, EXCLUDED.duration_ms),
           prompt_version = COALESCE(EXCLUDED.prompt_version, harness_usage.prompt_version),
           config_hash = COALESCE(EXCLUDED.config_hash, harness_usage.config_hash),
           routing_reason = COALESCE(EXCLUDED.routing_reason, harness_usage.routing_reason),
           updated_at = NOW()
       RETURNING *`,
      [
        id,
        run.ticket_id,
        projectId,
        run.agent_id,
        normalisedModel,
        boundedString(promptVersion, 'promptVersion', 100),
        boundedString(configHash, 'configHash', 128),
        boundedString(routingReason, 'routingReason', 500),
        input,
        output,
        cached,
        costUsd,
        tools,
        duration,
      ]
    );

    HarnessMetrics.recordUsage({
      inputTokens: inputDelta,
      outputTokens: outputDelta,
      costUsd: costDelta,
    });

    if (result.rows.length === 0) {
      throw new NotFoundError('Harness usage could not be stored');
    }
    const reservedUsd = Number(run.budget_reserved_usd || 0);
    const quotaExceeded = reservedUsd > 0
      && costUsd > reservedUsd + 0.000001;
    return { ...result.rows[0], quotaExceeded };
  }

  async listForRun(runId) {
    const id = requiredUuid(runId, 'runId');
    const result = await pool.query(
      `SELECT * FROM harness_usage
       WHERE run_id = $1
       ORDER BY model ASC`,
      [id]
    );
    return result.rows;
  }

  async getRunTotals(runId) {
    const id = requiredUuid(runId, 'runId');
    const result = await pool.query(
      `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(tool_calls), 0) AS tool_calls,
              COALESCE(MAX(duration_ms), 0) AS duration_ms
       FROM harness_usage
       WHERE run_id = $1`,
      [id]
    );
    const row = result.rows?.[0] || {};
    return {
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      cachedTokens: Number(row.cached_tokens || 0),
      costUsd: Number(row.cost_usd || 0),
      toolCalls: Number(row.tool_calls || 0),
      durationMs: Number(row.duration_ms || 0),
    };
  }

  async summarizeProject(projectId, { since = null, until = null } = {}) {
    const id = positiveInteger(projectId, 'projectId');
    const params = [id];
    const clauses = ['project_id = $1'];
    if (since) {
      const date = new Date(since);
      if (Number.isNaN(date.getTime())) throw new ValidationError('since must be a timestamp');
      params.push(date.toISOString());
      clauses.push(`created_at >= $${params.length}`);
    }
    if (until) {
      const date = new Date(until);
      if (Number.isNaN(date.getTime())) throw new ValidationError('until must be a timestamp');
      params.push(date.toISOString());
      clauses.push(`created_at <= $${params.length}`);
    }

    const result = await pool.query(
      `SELECT model,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_tokens) AS cached_tokens,
              SUM(cost_usd) AS cost_usd,
              SUM(tool_calls) AS tool_calls,
              COUNT(DISTINCT run_id) AS runs
       FROM harness_usage
       WHERE ${clauses.join(' AND ')}
       GROUP BY model
       ORDER BY cost_usd DESC, model ASC`,
      params
    );

    const models = (result.rows || []).map((row) => ({
      model: row.model,
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      cachedTokens: Number(row.cached_tokens || 0),
      costUsd: Number(row.cost_usd || 0),
      toolCalls: Number(row.tool_calls || 0),
      runs: Number(row.runs || 0),
    }));
    return {
      models,
      totals: models.reduce((acc, row) => ({
        inputTokens: acc.inputTokens + row.inputTokens,
        outputTokens: acc.outputTokens + row.outputTokens,
        cachedTokens: acc.cachedTokens + row.cachedTokens,
        costUsd: acc.costUsd + row.costUsd,
        toolCalls: acc.toolCalls + row.toolCalls,
      }), {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        toolCalls: 0,
      }),
    };
  }

  /**
   * Flush the final per-model usage into usage_logs for billing. Idempotent:
   * the unique partial index on (metadata->>'run_id', model) plus the
   * NOT EXISTS guard mean repeated finishes do not charge twice.
   */
  async flushRunToUsageLogs(runId) {
    const id = requiredUuid(runId, 'runId');
    try {
      await HarnessRunService.getRun(id);
    } catch (error) {
      logger.warn(`Harness usage flush skipped for run ${id}: ${error.message}`);
      return { inserted: 0 };
    }
    const result = await pool.query(
      `INSERT INTO usage_logs
         (project_id, agent_id, provider_type, model, tokens_in, tokens_out,
          cost_usd, duration_ms, ticket_id, request_type, metadata)
       SELECT u.project_id, u.agent_id, 'harness', u.model, u.input_tokens,
              u.output_tokens, u.cost_usd, u.duration_ms, u.ticket_id,
              'harness',
              jsonb_build_object('run_id', $1, 'cached_tokens', u.cached_tokens,
                                 'tool_calls', u.tool_calls)
       FROM harness_usage u
       WHERE u.run_id = $1
         AND u.project_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM usage_logs existing
           WHERE existing.request_type = 'harness'
             AND existing.metadata->>'run_id' = $1
             AND existing.model = u.model
         )
       RETURNING id`,
      [id]
    );

    if ((result.rowCount || 0) > 0) {
      logger.info(`Flushed harness usage for run ${id} (${result.rowCount} model row(s))`);
    }
    return { inserted: result.rowCount || 0 };
  }
}

const instance = new HarnessUsageService();
module.exports = instance;
module.exports.HarnessUsageService = HarnessUsageService;
module.exports.UUID_PATTERN = UUID_PATTERN;
