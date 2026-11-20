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

    if (this.projectId == null) {
      this.loaded = true;
      return;
    }

    // The registry is authoritative: active credentials plus verified models.
    // Project-scoped credentials win; owner-global credentials are the fallback.
    const rows = await pool.query(
      `SELECT pc.id AS credential_id,
              pc.provider_type,
              pc.api_key_encrypted,
              pc.base_url,
              pm.id AS model_id,
              pm.model,
              pm.max_tokens,
              pm.roles
       FROM provider_credentials pc
       JOIN provider_models pm ON pm.credential_id = pc.id
       JOIN projects p ON p.id = $1
       WHERE pc.status = 'active'
         AND pm.status = 'verified'
         AND (pc.project_id = $1
              OR (pc.project_id IS NULL AND pc.owner_id = p.owner_id))
       ORDER BY (pc.project_id IS NULL) ASC, pc.id ASC, pm.id ASC`,
      [this.projectId]
    );

    for (const row of rows.rows) {
      const decryptedKey = decrypt(row.api_key_encrypted);
      const config = {
        apiKey: decryptedKey,
        model: row.model,
        maxTokens: row.max_tokens || 4096,
        temperature: 0.1,
        baseUrl: row.base_url || undefined,
        projectId: this.projectId,
        userId: this.context.userId || null,
        agentId: this.context.agentId || null,
        ticketId: this.context.ticketId || null,
      };

      const provider = this.createProvider(row.provider_type, config);
      for (const role of row.roles || []) {
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
      case 'anthropic':
        return new ClaudeProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'opencode':
      case 'opencode-go':
      case 'generic':
      case 'ollama':
      case 'vllm':
      case 'llamacpp':
      case 'custom':
        return new GenericProvider({ ...config, providerType: type });
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

}

module.exports = ProviderRouter;
