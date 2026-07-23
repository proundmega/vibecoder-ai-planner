const { pool } = require('../db');
const { calculateCost } = require('../utils/pricing');

class UsageLogger {
  static async log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId = null, options = {}) {
    const { planningStage, fileKey } = options;
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
  }

  static async reportUsage(agentId, data) {
    const { provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id, project_id, planning_stage, file_keys } = data;

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
  }

  static async logPlanningUsage(planData) {
    const {
      projectId, userId, agentId,
      ticketId, planningStage, fileKeys,
      providerType, model, tokensIn, tokensOut, durationMs,
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
}

module.exports = UsageLogger;
