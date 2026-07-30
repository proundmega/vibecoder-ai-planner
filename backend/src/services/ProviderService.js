const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');

class ProviderService {
  async getProjectProviders(projectId) {
    const result = await pool.query(
      `SELECT * FROM providers
       WHERE (project_id = $1 OR project_id IS NULL) AND is_active = true
       ORDER BY project_id IS NULL ASC`,
      [projectId]
    );
    return result.rows;
  }

  async resolveProvider(ticketInfo, projectId = null) {
    const providers = await this.getProjectProviders(projectId);

    if (providers.length === 0) {
      throw new Error('No active provider configuration found');
    }

    const projectProviders = providers.filter(p => projectId !== null && p.project_id === projectId);
    const globalProviders = providers.filter(p => p.project_id === null);

    for (const provider of projectProviders) {
      const config = await this._tryResolve(provider, ticketInfo);
      if (config) return config;
    }

    // First pass: check providers with routing rules
    const providersWithRules = globalProviders.filter(p =>
      p.routing_rules && Array.isArray(p.routing_rules.rules) && p.routing_rules.rules.length > 0
    );
    const providersWithoutRules = globalProviders.filter(p =>
      !p.routing_rules || !Array.isArray(p.routing_rules.rules) || p.routing_rules.rules.length === 0
    );

    for (const provider of providersWithRules) {
      const config = await this._tryResolve(provider, ticketInfo);
      if (config) return config;
    }

    for (const provider of providersWithoutRules) {
      const config = await this._tryResolve(provider, ticketInfo);
      if (config) return config;
    }

    throw new Error('No matching provider configuration found');
  }

  async _tryResolve(provider, ticketInfo) {
    const rules = provider.routing_rules;
    if (!rules || !Array.isArray(rules.rules) || rules.rules.length === 0) {
      return this._defaultProvider(provider);
    }

    const ticketLabels = new Set(ticketInfo.labels || []);
    const ticketPriority = ticketInfo.priority || 'medium';

    for (const rule of rules.rules) {
      if (this._matches(rule.match, ticketLabels, ticketPriority)) {
        return this._buildProviderConfig(provider, rule, false);
      }
    }

    if (rules.fallback) {
      return this._buildProviderConfig(provider, rules.fallback, true);
    }

    return null;
  }

  _matches(match, ticketLabels, ticketPriority) {
    if (!match) return true;

    if (match.labels && Array.isArray(match.labels) && match.labels.length > 0) {
      const requiredLabels = new Set(match.labels);
      let matched = false;
      for (const label of ticketLabels) {
        if (requiredLabels.has(label)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }

    if (match.priority && match.priority !== ticketPriority) {
      return false;
    }

    return true;
  }

  _buildProviderConfig(baseConfig, ruleConfig, isFallback) {
    const apiKey = ruleConfig.api_key
      ? ruleConfig.api_key
      : decrypt(baseConfig.api_key_encrypted);

    return {
      provider: ruleConfig.provider || baseConfig.provider_type,
      endpoint_url: ruleConfig.endpoint_url || ruleConfig.base_url || baseConfig.base_url || null,
      model: ruleConfig.model || baseConfig.model,
      api_key: apiKey,
      max_tokens: ruleConfig.max_tokens || baseConfig.max_tokens || 4096,
      temperature: ruleConfig.temperature !== undefined
        ? ruleConfig.temperature
        : (baseConfig.temperature || 0.1),
      is_fallback: isFallback,
    };
  }

  _defaultProvider(config) {
    return {
      provider: config.provider_type,
      endpoint_url: config.base_url || config.endpoint_url || null,
      model: config.model,
      api_key: decrypt(config.api_key_encrypted),
      max_tokens: config.max_tokens || 4096,
      temperature: config.temperature || 0.1,
      is_fallback: false,
    };
  }
}

module.exports = new ProviderService();
