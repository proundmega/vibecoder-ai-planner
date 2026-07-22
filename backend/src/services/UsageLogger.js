const { pool } = require('../db');
const { calculateCost } = require('../utils/pricing');

class UsageLogger {
  static async log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId = null) {
    const tokensIn = usage?.input_tokens || usage?.tokens_in || 0;
    const tokensOut = usage?.output_tokens || usage?.tokens_out || 0;
    const cost = calculateCost(model, tokensIn, tokensOut);

    await pool.query(
      `INSERT INTO usage_logs
       (project_id, user_id, agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [projectId, userId, agentId, providerType, model, tokensIn, tokensOut, cost, durationMs || 0, ticketId]
    );
  }

  static async reportUsage(agentId, data) {
    const { provider_type, model, tokens_in, tokens_out, duration_ms, ticket_id, project_id } = data;

    if (!provider_type || !model || tokens_in == null || tokens_out == null) {
      const err = new Error('Missing required fields: provider_type, model, tokens_in, tokens_out');
      err.statusCode = 400;
      throw err;
    }

    const cost = calculateCost(model, tokens_in, tokens_out);

    await pool.query(
      `INSERT INTO usage_logs
       (agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [agentId, provider_type, model, tokens_in, tokens_out, cost, duration_ms || 0, ticket_id || null, project_id || null]
    );
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
