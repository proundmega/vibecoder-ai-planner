const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');
const { resolveProviderEndpoint } = require('../utils/providerDefaults');

class ProviderService {
  constructor() {
    this.cache = new Map();
    this.cacheTtl = 300000; // 5 minutes
  }

  async getProjectProviders(projectId, userId = null, role = 'worker') {
    const cacheKey = `provider:${projectId || 'global'}:${userId || 'none'}:${role}`;
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
      return cached.providers;
    }

    let result = { rows: [] };
    if (projectId != null) {
      result = await pool.query(
        `SELECT pc.id AS credential_id,
                pc.provider_type,
                pc.api_key_encrypted,
                pc.base_url,
                pc.project_id,
                pm.id AS model_id,
                pm.model,
                pm.max_tokens,
                pm.roles,
                pm.effort
         FROM provider_credentials pc
         JOIN provider_models pm ON pm.credential_id = pc.id
         JOIN projects p ON p.id = $1
         WHERE pc.status = 'active'
           AND pm.status = 'verified'
           AND $3 = ANY(pm.roles)
           AND (pc.project_id = $1
                OR (pc.project_id IS NULL AND pc.owner_id = $2))
         ORDER BY (pc.project_id IS NULL) ASC, pc.id ASC, pm.id ASC`,
        [projectId, userId, role]
      );
    } else if (userId != null) {
      result = await pool.query(
        `SELECT pc.id AS credential_id,
                pc.provider_type,
                pc.api_key_encrypted,
                pc.base_url,
                pc.project_id,
                pm.id AS model_id,
                pm.model,
                pm.max_tokens,
                pm.roles,
                pm.effort
         FROM provider_credentials pc
         JOIN provider_models pm ON pm.credential_id = pc.id
         WHERE pc.status = 'active'
           AND pm.status = 'verified'
           AND $2 = ANY(pm.roles)
           AND pc.project_id IS NULL
           AND pc.owner_id = $1
         ORDER BY pc.id ASC, pm.id ASC`,
        [userId, role]
      );
    }

    this.cache.set(cacheKey, { providers: result.rows, timestamp: Date.now() });
    return result.rows;
  }

  invalidateProviderCache(projectId = null) {
    if (projectId) {
      const prefix = `provider:${projectId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
  }

  async getProviderConfigChange(agentId, sinceTimestamp) {
    const AgentService = require('./AgentService');
    const agent = await AgentService.findById(agentId);
    
    if (!agent || !agent.provider_id) {
      return { changed: false, lastUpdated: null };
    }

    const result = await pool.query(
      `SELECT updated_at FROM providers WHERE id = $1`,
      [agent.provider_id]
    );

    if (!result.rows[0] || !result.rows[0].updated_at) {
      return { changed: false, lastUpdated: null };
    }

    const updatedAt = new Date(result.rows[0].updated_at);
    const since = sinceTimestamp ? new Date(sinceTimestamp) : new Date(0);
    const changed = updatedAt > since;

    return {
      changed,
      lastUpdated: updatedAt.toISOString(),
    };
  }

  async resolveProvider(ticketInfo = {}, projectId = null, userId = null) {
    const role = this.roleForTicket(ticketInfo);
    const providers = await this.getProjectProviders(projectId, userId, role);

    if (providers.length === 0) {
      throw new Error('No active provider configuration found');
    }

    return this._registryProviderConfig(providers[0]);
  }

  roleForTicket(ticketInfo = {}) {
    if (['worker', 'reviewer', 'planner'].includes(ticketInfo.role)) {
      return ticketInfo.role;
    }
    switch (ticketInfo.phase) {
      case 'planning':
      case 'plan':
      case 'plan_approved':
        return 'planner';
      case 'review':
      case 'human_approval':
        return 'reviewer';
      default:
        return 'worker';
    }
  }

  _registryProviderConfig(config) {
    return {
      provider: config.provider_type,
      endpoint_url: resolveProviderEndpoint({
        providerType: config.provider_type,
        baseUrl: config.base_url,
      }),
      model: config.model,
      api_key: decrypt(config.api_key_encrypted),
      max_tokens: config.max_tokens || 4096,
      temperature: 0.1,
      is_fallback: false,
    };
  }
}

module.exports = new ProviderService();
