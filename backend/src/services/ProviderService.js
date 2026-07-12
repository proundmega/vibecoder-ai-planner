const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');

class ProviderService {
  async getGlobalProvider() {
    const result = await pool.query(
      `SELECT * FROM providers
       WHERE is_project_director = true AND is_active = true
       LIMIT 1`
    );
    return result.rows[0] || null;
  }

  async resolveProvider(ticketInfo) {
    const config = await this.getGlobalProvider();
    if (!config) {
      throw new Error('No active provider configuration found');
    }

    const rules = config.routing_rules;
    if (!rules || !Array.isArray(rules.rules) || rules.rules.length === 0) {
      return this._defaultProvider(config);
    }

    const ticketLabels = new Set(ticketInfo.labels || []);
    const ticketPriority = ticketInfo.priority || 'medium';

    for (const rule of rules.rules) {
      if (this._matches(rule.match, ticketLabels, ticketPriority)) {
        return this._buildProviderConfig(config, rule, false);
      }
    }

    if (rules.fallback) {
      return this._buildProviderConfig(config, rules.fallback, true);
    }

    return this._defaultProvider(config);
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
