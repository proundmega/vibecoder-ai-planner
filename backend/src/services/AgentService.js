const { pool } = require('../db');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;
const DEFAULT_KEY_EXPIRY_DAYS = 30;

class AgentService {
  async create(name, apiKey, userId) {
    const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);

    const result = await pool.query(
      `INSERT INTO agents (name, api_key, api_key_hash, api_key_expires_at, owner_id, rate_limit, max_actions_per_day) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, name, api_key, api_key_expires_at, created_at`,
      [name, apiKey, apiKeyHash, expiresAt, userId, 100, 1000]
    );
    return result.rows[0];
  }

  async rotateKey(agentId, userId) {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);

    const result = await pool.query(
      `UPDATE agents 
       SET api_key = $1, api_key_hash = $2, api_key_expires_at = $3
       WHERE id = $4 AND owner_id = $5
       RETURNING id, name, api_key, api_key_expires_at`,
      [apiKey, apiKeyHash, expiresAt, agentId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('AGENT_NOT_FOUND');
    }

    const agent = result.rows[0];
    return { ...agent, apiKey };
  }

  async list(userId) {
    const result = await pool.query(
      'SELECT * FROM agents WHERE owner_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  }

  async getApiKey(agentId) {
    const result = await pool.query(
      'SELECT api_key FROM agents WHERE id = $1',
      [agentId]
    );
    return result.rows[0] ? result.rows[0].api_key : null;
  }

  async revokeApiKey(agentId) {
    await pool.query('UPDATE agents SET api_key = NULL WHERE id = $1', [agentId]);
  }

  async registerAction(agentId, actionType, tableName, recordId) {
    const result = await pool.query(
      `INSERT INTO agent_actions 
       (agent_id, action_type, table_name, record_id, cost_incurred) 
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [agentId, actionType, tableName, recordId, 0.05]
    );
    return result.rows[0];
  }

  async getAgentDailyLimit(agentId, date = new Date()) {
    const result = await pool.query(/*sql*/ `
      SELECT 
        a.rate_limit,
        a.max_actions_per_day,
        COUNT(aa.id) as actions_today
      FROM agents a
      LEFT JOIN agent_actions aa 
        ON aa.agent_id = a.id 
        AND DATE(aa.created_at) = DATE($1)
      WHERE a.id = $2
      GROUP BY a.id
    `);
    const row = result.rows[0];
    if (!row) return { available: 0, used: 0, limit: 100 };
    
    const actionsToday = row.actions_today || 0;
    return {
      used: actionsToday,
      available: row.max_actions_per_day - actionsToday,
      limit: row.max_actions_per_day,
      resetAt: new Date(date.setHours(date.getHours() + 24))
    };
  }

  async getAgentHistory(agentId, limit = 50) {
    const result = await pool.query(
      `SELECT * FROM agent_actions 
       WHERE agent_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [agentId, limit]
    );
    return result.rows;
  }

  async delete(agentId) {
    await pool.query('DELETE FROM agents WHERE id = $1', [agentId]);
  }

  async getAgentByApiKey(apiKey) {
    const result = await pool.query(
      'SELECT * FROM agents WHERE api_key = $1',
      [apiKey]
    );
    return result.rows[0];
  }

  async getAgentTickets(agentId, projectId) {
    const result = await pool.query(
      `SELECT t.*, u.name as assignee_name 
       FROM tickets t 
       LEFT JOIN users u ON t.assignee_id = u.id 
       JOIN projects p ON t.project_id = p.id 
       WHERE p.owner_id = ANY(
         SELECT user_id FROM project_agents WHERE project_id = (
           SELECT id FROM projects WHERE owner_id = (
             SELECT id FROM agents WHERE id = $1
           )
         )
       ) AND t.project_id = $2
       ORDER BY t.created_at DESC`,
      [agentId, projectId]
    );
    return result.rows;
  }

  async incrementDailyUsage(agentId) {
    await pool.query(
      'UPDATE agents SET current_daily_usage = current_daily_usage + 1 WHERE id = $1',
      [agentId]
    );
  }
}

module.exports = new AgentService();
