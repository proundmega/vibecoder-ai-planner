const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');
const ClaudeProvider = require('../providers/claude');
const OpenAIProvider = require('../providers/openai');
const GenericProvider = require('../providers/generic');

class ProviderRouter {
  constructor(projectId, context = {}) {
    this.projectId = projectId;
    this.context = context; // { userId, agentId, ticketId }
    this.providers = new Map();
    this.loaded = false;
  }

  async loadProviders() {
    if (this.loaded) return;

    const rows = await pool.query(
      `SELECT * FROM project_providers WHERE project_id = $1 AND is_active = true`,
      [this.projectId]
    );

    for (const row of rows.rows) {
      const decryptedKey = decrypt(row.api_key_encrypted);
      const config = {
        apiKey: decryptedKey,
        model: row.model,
        maxTokens: row.max_tokens,
        temperature: row.temperature,
        baseUrl: row.base_url || row.endpoint_url,
        projectId: this.projectId,
        userId: this.context.userId || null,
        agentId: this.context.agentId || null,
        ticketId: this.context.ticketId || null,
      };

      const provider = this.createProvider(row.provider_type, config);
      for (const role of row.roles) {
        this.providers.set(`${this.projectId}:${role}`, provider);
      }
    }

    this.loaded = true;
  }

  getForRole(role) {
    const key = `${this.projectId}:${role}`;
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`No provider configured for role: ${role}`);
    }
    return provider;
  }

  static async getProvidersForProject(projectId, context = {}) {
    const instance = new ProviderRouter(projectId, context);
    await instance.loadProviders();
    return instance;
  }

  getAllProviders() {
    return Array.from(this.providers.values());
  }

  createProvider(type, config) {
    switch (type) {
      case 'claude':
        return new ClaudeProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'generic':
      case 'ollama':
      case 'vllm':
      case 'llamacpp':
      case 'custom':
        return new GenericProvider(config);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  static async getProvidersForProject(projectId) {
    const rows = await pool.query(
      `SELECT * FROM project_providers WHERE project_id = $1 AND is_active = true`,
      [projectId]
    );
    return rows.rows;
  }
}

module.exports = ProviderRouter;
