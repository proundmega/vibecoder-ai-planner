const { pool } = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { resolveProviderEndpoint } = require('../utils/providerDefaults');
const AgentEnrollmentService = require('./AgentEnrollmentService');

const SALT_ROUNDS = 10;
const DEFAULT_KEY_EXPIRY_DAYS = 30;
const PREFIX_LENGTH = 20;

// Deterministic hash for API key lookup (bcrypt generates different hashes each time)
function deterministicApiKeyPrefix(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, PREFIX_LENGTH);
}

class AgentService {
  async findById(agentId) {
    const result = await pool.query(
      `SELECT a.*, p.name as provider_name, p.provider_type as provider_type
       FROM agents a
       LEFT JOIN providers p ON a.provider_id = p.id
       WHERE a.id = $1`,
      [agentId]
    );
    return result.rows[0] || null;
  }

  async create(name, apiKey, userId, { providerId = null, rateLimit = 100, maxActionsPerDay = 1000, keyExpiryDays = 30 } = {}) {
    if (providerId) {
      const providerCheck = await pool.query('SELECT id FROM providers WHERE id = $1', [providerId]);
      if (providerCheck.rows.length === 0) {
        throw new Error('PROVIDER_NOT_FOUND');
      }
    }

    const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
    const apiKeyLookupPrefix = deterministicApiKeyPrefix(apiKey);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + keyExpiryDays);

    const result = await pool.query(
      `INSERT INTO agents (name, api_key_hash, api_key_hash_prefix, api_key_expires_at, owner_id, provider_id, rate_limit, max_actions_per_day) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, name, api_key_expires_at, provider_id, created_at`,
      [name, apiKeyHash, apiKeyLookupPrefix, expiresAt, userId, providerId, rateLimit, maxActionsPerDay]
    );
    return { ...result.rows[0], api_key: apiKey };
  }

  async rotateKey(agentId) {
    const apiKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
    const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
    const apiKeyLookupPrefix = deterministicApiKeyPrefix(apiKey);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_KEY_EXPIRY_DAYS);

    const result = await pool.query(
      `UPDATE agents 
       SET api_key_hash = $1, api_key_hash_prefix = $2, api_key_expires_at = $3
       WHERE id = $4
       RETURNING id, name, api_key_expires_at`,
      [apiKeyHash, apiKeyLookupPrefix, expiresAt, agentId]
    );

    if (result.rows.length === 0) {
      throw new Error('AGENT_NOT_FOUND');
    }

    const agent = result.rows[0];
    return { ...agent, api_key: apiKey };
  }

  async list(userId, { projectId = null } = {}) {
    const params = [userId];
    let sql = `SELECT agents.*, providers.name as provider_name, providers.provider_type as provider_type
       FROM agents
       LEFT JOIN providers ON agents.provider_id = providers.id
       WHERE agents.owner_id = $1`;
    if (projectId != null) {
      // An enrolled agent token must not enumerate the owner's agents in
      // other projects.
      params.push(projectId);
      sql += ' AND agents.project_id = $2';
    }
    sql += ' ORDER BY agents.created_at DESC';
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async revokeApiKey(agentId) {
    await pool.query('UPDATE agents SET api_key_hash = NULL, api_key_hash_prefix = NULL WHERE id = $1', [agentId]);
    // FR6: revoking an agent invalidates every credential it holds, not only
    // the legacy key.
    await AgentEnrollmentService.revokeAllForAgent(agentId);
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
    `, [agentId, date]);
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

  async updateName(agentId, name, userId) {
    const result = await pool.query(
      'UPDATE agents SET name = $1 WHERE id = $2 AND owner_id = $3 RETURNING id, name, updated_at',
      [name, agentId, userId]
    );
    if (result.rows.length === 0) throw new Error('AGENT_NOT_FOUND');
    return result.rows[0];
  }

  async getProviderConfig(agentId, apiKey) {
    let agent;
    if (typeof apiKey === 'string' && apiKey.startsWith('at_')) {
      const auth = await AgentEnrollmentService.authenticateAccessToken(apiKey);
      if (auth.status === 'expired') throw new Error('TOKEN_EXPIRED');
      if (auth.status !== 'ok') throw new Error('AGENT_NOT_FOUND');
      agent = auth.agent;
    } else {
      agent = await this.getAgentByApiKey(apiKey);
      if (agent && agent.api_key_expires_at && new Date(agent.api_key_expires_at) <= new Date()) {
        throw new Error('TOKEN_EXPIRED');
      }
    }
    if (!agent) throw new Error('AGENT_NOT_FOUND');
    if (String(agent.id) !== String(agentId)) throw new Error('AGENT_NOT_FOUND');
    if (!agent.provider_id) throw new Error('NO_PROVIDER');
    const enc = require('../utils/crypto');
    const result = await pool.query(
      `SELECT p.provider_type, p.api_key_encrypted, p.base_url, p.endpoint_url,
              p.model, p.max_tokens
       FROM providers p WHERE p.id = $1`, [agent.provider_id]
    );
    if (result.rows.length === 0) throw new Error('PROVIDER_NOT_FOUND');
    const provider = result.rows[0];
    const decryptedKey = provider.api_key_encrypted ? enc.decrypt(provider.api_key_encrypted) : null;
    return {
      provider_type: provider.provider_type,
      api_key: decryptedKey,
      base_url: resolveProviderEndpoint({
        providerType: provider.provider_type,
        baseUrl: provider.base_url,
        endpointUrl: provider.endpoint_url,
      }),
      model: provider.model,
      max_tokens: provider.max_tokens,
    };
  }

  async getAgentByApiKey(apiKey) {
    if (typeof apiKey === 'string' && apiKey.startsWith('at_')) {
      const result = await AgentEnrollmentService.authenticateAccessToken(apiKey);
      return result.status === 'ok' ? { ...result.agent, _tokenKind: 'access' } : null;
    }

    const apiKeyLookupPrefix = deterministicApiKeyPrefix(apiKey);

    const result = await pool.query(
      `SELECT agents.*, providers.name as provider_name, providers.provider_type as provider_type
       FROM agents 
       LEFT JOIN providers ON agents.provider_id = providers.id
        WHERE agents.api_key_hash_prefix = $1`,
      [apiKeyLookupPrefix]
    );

    // Verify with bcrypt.compare (timing-safe) since prefix is not unique
    for (const agent of result.rows) {
      if (agent.api_key_hash && await bcrypt.compare(apiKey, agent.api_key_hash)) {
        return agent;
      }
    }
    return null;
  }

  async incrementDailyUsage(agentId) {
    await pool.query(
      'UPDATE agents SET current_daily_usage = current_daily_usage + 1 WHERE id = $1',
      [agentId]
    );
  }
}

module.exports = new AgentService();
