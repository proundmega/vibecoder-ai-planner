const { pool } = require('../db');

class BillingService {
  static async aggregateDailyBilling(date = new Date()) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const result = await pool.query(
      `SELECT project_id,
              SUM(cost_usd) as total_cost,
              SUM(tokens_in) as total_in,
              SUM(tokens_out) as total_out,
              COUNT(*) as total_calls
       FROM usage_logs
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY project_id`,
      [dayStart, dayEnd]
    );

    for (const row of result.rows) {
      await pool.query(
        `INSERT INTO project_billing
         (project_id, billing_month, total_cost_usd, total_tokens_in, total_tokens_out, total_calls)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, billing_month)
         DO UPDATE SET total_cost_usd = $3, total_tokens_in = $4, total_tokens_out = $5, total_calls = $6, updated_at = CURRENT_TIMESTAMP`,
        [row.project_id, dayStart.toISOString().split('T')[0], row.total_cost, row.total_in, row.total_out, row.total_calls]
      );
    }

    return result.rows.length;
  }

  static async getProjectBilling(projectId, month) {
    const result = await pool.query(
      `SELECT * FROM project_billing
       WHERE project_id = $1 AND billing_month = $2
       ORDER BY billing_month DESC
       LIMIT 12`,
      [projectId, month]
    );
    return result.rows;
  }

  static async getProjectBillingRange(projectId, start, end) {
    const result = await pool.query(
      `SELECT billing_month, total_cost_usd, total_tokens_in, total_tokens_out, total_calls
       FROM project_billing
       WHERE project_id = $1 AND billing_month >= $2 AND billing_month <= $3
       ORDER BY billing_month ASC`,
      [projectId, start, end]
    );
    return result.rows;
  }

  static async getUserBilling(userId) {
    const result = await pool.query(
      `SELECT
         p.id as project_id,
         p.name as project_name,
         pb.billing_month,
         pb.total_cost_usd,
         pb.total_tokens_in,
         pb.total_tokens_out,
         pb.total_calls
       FROM project_billing pb
       JOIN projects p ON pb.project_id = p.id
       JOIN project_memberships pm ON p.id = pm.project_id
       WHERE pm.user_id = $1 AND pb.is_finalized = true
       ORDER BY pb.billing_month DESC
       LIMIT 12`,
      [userId]
    );
    return result.rows;
  }

  static async getUsageSince(projectId, since) {
    const result = await pool.query(
      `SELECT
         provider_type, model,
         SUM(tokens_in) as total_in,
         SUM(tokens_out) as total_out,
         SUM(cost_usd) as total_cost,
         COUNT(*) as total_calls
       FROM usage_logs
       WHERE project_id = $1 AND created_at >= $2
       GROUP BY provider_type, model
       ORDER BY total_cost DESC`,
      [projectId, since]
    );
    return result.rows;
  }
}

module.exports = BillingService;
