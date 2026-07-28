const { pool } = require('../db');
const { calculateCost } = require('../utils/pricing');
const EventHashService = require('./EventHashService');
const logger = require('../utils/logger');

class UsageLogger {
  static async log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId = null, options = {}) {
    const { planningStage, fileKey, rawUsage } = options;
    const tokensIn = usage?.input_tokens || usage?.tokens_in || 0;
    const tokensOut = usage?.output_tokens || usage?.tokens_out || 0;
    const cost = calculateCost(model, tokensIn, tokensOut);

    await pool.query(
      `INSERT INTO usage_logs
       (project_id, user_id, agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id, planning_stage, file_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [projectId, userId, agentId, providerType, model, tokensIn, tokensOut, cost, durationMs || 0, ticketId || null, planningStage || null, fileKey || null]
    );

    // Update last-known usage on ticket_planning if fileKey provided
    if (fileKey && ticketId) {
      await pool.query(
        `UPDATE ticket_planning
         SET last_tokens_in = $1, last_tokens_out = $2, last_cost_usd = $3,
             last_duration_ms = $4, last_provider_type = $5, last_model = $6,
             last_planning_stage = $7, last_ai_call_at = NOW()
         WHERE ticket_id = $8 AND file_key = $9`,
        [tokensIn, tokensOut, cost, durationMs || 0, providerType, model, planningStage || null, ticketId, fileKey]
      );
    }

    // Dual-write to telemetry_events
    await UsageLogger.logStructuredEvent({
      providerType, model, rawUsage: rawUsage || usage,
      durationMs, projectId, userId, agentId, ticketId,
      planningStage, fileKey,
    });
  }

  static async reportUsage(agentId, data) {
    const { provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id, project_id, planning_stage, file_keys, raw_usage } = data;

    if (!provider_type || !model || tokens_in == null || tokens_out == null) {
      const err = new Error('Missing required fields: provider_type, model, tokens_in, tokens_out');
      err.statusCode = 400;
      throw err;
    }

    const cost = calculateCost(model, tokens_in, tokens_out);

    // Primary entry with first file_key if provided
    const primaryFileKey = file_keys && file_keys.length > 0 ? file_keys[0] : null;

    await pool.query(
      `INSERT INTO usage_logs
       (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id, project_id, planning_stage, file_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [agentId, provider_type, model, tokens_in, tokens_out, cost, duration_ms || 0, ticket_id || null, project_id || null, planning_stage || null, primaryFileKey]
    );

    // Additional entries per file_key (skip first since already logged)
    if (file_keys && file_keys.length > 1) {
      for (let i = 1; i < file_keys.length; i++) {
        await pool.query(
          `INSERT INTO usage_logs
           (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id, project_id, planning_stage, file_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [agentId, provider_type, model, tokens_in, tokens_out, cost, duration_ms || 0, ticket_id || null, project_id || null, planning_stage || null, file_keys[i]]
        );
      }
    }

    // Dual-write to telemetry_events
    await UsageLogger.logStructuredEvent({
      providerType: provider_type, model,
      rawUsage: raw_usage || { tokens_in, tokens_out }, durationMs: duration_ms,
      projectId: project_id, userId: null, agentId,
      ticketId: ticket_id, planningStage: planning_stage,
      fileKey: primaryFileKey,
    });
  }

  static async logPlanningUsage(planData) {
    const {
      projectId, userId, agentId,
      ticketId, planningStage, fileKeys,
      providerType, model, tokensIn, tokensOut, durationMs, rawUsage,
    } = planData;

    const cost = calculateCost(model, tokensIn, tokensOut);

    if (fileKeys && fileKeys.length > 0) {
      for (const fk of fileKeys) {
        await pool.query(
          `INSERT INTO usage_logs
           (project_id, user_id, agent_id, provider_type, model,
            tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
            planning_stage, file_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [projectId, userId, agentId, providerType, model,
            tokensIn, tokensOut, cost, durationMs || 0, ticketId || null,
            planningStage, fk]
        );

        await pool.query(
          `UPDATE ticket_planning
           SET last_tokens_in = $1, last_tokens_out = $2, last_cost_usd = $3,
               last_duration_ms = $4, last_provider_type = $5, last_model = $6,
               last_planning_stage = $7, last_ai_call_at = NOW()
           WHERE ticket_id = $8 AND file_key = $9`,
          [tokensIn, tokensOut, cost, durationMs || 0, providerType, model,
            planningStage, ticketId, fk]
        );

        // Dual-write to telemetry_events
        await UsageLogger.logStructuredEvent({
          providerType, model, rawUsage: rawUsage || { input_tokens: tokensIn, output_tokens: tokensOut },
          durationMs, projectId, userId, agentId, ticketId,
          planningStage, fileKey: fk,
        });
      }
    } else {
      await pool.query(
        `INSERT INTO usage_logs
         (project_id, user_id, agent_id, provider_type, model,
          tokens_in, tokens_out, cost_usd, duration_ms, ticket_id,
          planning_stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [projectId, userId, agentId, providerType, model,
          tokensIn, tokensOut, cost, durationMs || 0, ticketId || null,
          planningStage]
      );

      // Dual-write to telemetry_events
      await UsageLogger.logStructuredEvent({
        providerType, model, rawUsage: rawUsage || { input_tokens: tokensIn, output_tokens: tokensOut },
        durationMs, projectId, userId, agentId, ticketId,
        planningStage, fileKey: null,
      });
    }
  }

  static async getProjectUsage(projectId, since, until) {
    const result = await pool.query(
      `SELECT
         provider_type, model,
         SUM(tokens_in) as total_in,
         SUM(tokens_out) as total_out,
         SUM(cost_usd) as total_cost,
         COUNT(*) as total_calls
       FROM usage_logs
       WHERE project_id = $1 AND created_at BETWEEN $2 AND $3
       GROUP BY provider_type, model
       ORDER BY total_cost DESC`,
      [projectId, since, until]
    );
    return result.rows;
  }

  static async getUserUsage(userId, since, until) {
    const result = await pool.query(
      `SELECT
         p.name as project_name,
         provider_type, model,
         SUM(cost_usd) as total_cost,
         COUNT(*) as total_calls
       FROM usage_logs ul
       JOIN projects p ON ul.project_id = p.id
       WHERE ul.user_id = $1 AND ul.created_at BETWEEN $2 AND $3
       GROUP BY p.name, provider_type, model
       ORDER BY total_cost DESC`,
      [userId, since, until]
    );
    return result.rows;
  }

  static async getTotalUsage(projectId, since, until) {
    const result = await pool.query(
      `SELECT
         SUM(tokens_in) as total_in,
         SUM(tokens_out) as total_out,
         SUM(cost_usd) as total_cost,
         COUNT(*) as total_calls
       FROM usage_logs
       WHERE project_id = $1 AND created_at BETWEEN $2 AND $3`,
      [projectId, since, until]
    );
    return result.rows[0] || { total_in: 0, total_out: 0, total_cost: 0, total_calls: 0 };
  }

  static _buildRawProviderFields(providerType, rawUsage) {
    if (!rawUsage || typeof rawUsage !== 'object') return {};
    const raw = { ...rawUsage };
    delete raw._request_id;
    delete raw._response_ms;
    return raw;
  }

  static _buildNormalizedFields(providerType, rawUsage, durationMs, model) {
    const raw = rawUsage || {};
    let tokensIn = 0;
    let tokensOut = 0;

    if (providerType === 'claude') {
      tokensIn = raw.input_tokens || 0;
      tokensOut = raw.output_tokens || 0;
    } else if (providerType === 'openai' || providerType === 'generic') {
      tokensIn = raw.prompt_tokens || 0;
      tokensOut = raw.completion_tokens || 0;
    }

    return {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      tokens_total: tokensIn + tokensOut,
      duration_ms: durationMs || 0,
      provider_type: providerType,
      model: model || 'unknown',
    };
  }

  static _buildDerivedMetrics(normalizedFields, model) {
    const { tokens_in, tokens_out, duration_ms } = normalizedFields;
    const cost = calculateCost(model, tokens_in, tokens_out);
    const tokensPerSecond = duration_ms > 0
      ? Math.round((tokens_out / (duration_ms / 1000)) * 10) / 10
      : 0;

    return {
      cost_usd: cost,
      tokens_per_second: tokensPerSecond,
    };
  }

  static _buildFieldProvenance(providerType) {
    const provenance = {
      raw_provider_fields: 'raw:provider_response',
      'normalized_fields.duration_ms': 'raw:backend_measured',
      'derived_metrics.cost_usd': 'derived:pricing.js(model,tokens_in,tokens_out)',
      'derived_metrics.tokens_per_second': 'derived:tokens_out/duration_ms',
    };

    if (providerType === 'claude') {
      provenance['normalized_fields.tokens_in'] = 'normalized:input_tokens→tokens_in';
      provenance['normalized_fields.tokens_out'] = 'normalized:output_tokens→tokens_out';
    } else {
      provenance['normalized_fields.tokens_in'] = 'normalized:prompt_tokens→tokens_in';
      provenance['normalized_fields.tokens_out'] = 'normalized:completion_tokens→tokens_out';
    }

    return provenance;
  }

  static async logStructuredEvent({
    providerType, model, rawUsage, durationMs,
    projectId, userId, agentId, ticketId, planningStage, fileKey,
  }) {
    try {
      const rawProviderFields = UsageLogger._buildRawProviderFields(providerType, rawUsage);
      const normalizedFields = UsageLogger._buildNormalizedFields(providerType, rawUsage, durationMs, model);
      const derivedMetrics = UsageLogger._buildDerivedMetrics(normalizedFields, model);
      const fieldProvenance = UsageLogger._buildFieldProvenance(providerType);

      const payload = {
        schema_version: 1,
        provider_type: providerType,
        model: model || 'unknown',
        raw_provider_fields: rawProviderFields,
        normalized_fields: normalizedFields,
        derived_metrics: derivedMetrics,
        field_provenance: fieldProvenance,
      };

      const contentHash = EventHashService.computeHash(payload);

      await pool.query(
        `INSERT INTO telemetry_events
         (schema_version, content_hash, provider_type, model,
          raw_provider_fields, normalized_fields, derived_metrics, field_provenance,
          project_id, user_id, agent_id, ticket_id, planning_stage, file_key, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (content_hash) DO NOTHING`,
        [
          1, contentHash, providerType, model || 'unknown',
          JSON.stringify(rawProviderFields), JSON.stringify(normalizedFields),
          JSON.stringify(derivedMetrics), JSON.stringify(fieldProvenance),
          projectId || null, userId || null, agentId || null,
          ticketId || null, planningStage || null, fileKey || null,
          durationMs || 0,
        ]
      );
    } catch (e) {
      logger.warn('Failed to write structured telemetry event:', e.message);
    }
  }
}

module.exports = UsageLogger;
