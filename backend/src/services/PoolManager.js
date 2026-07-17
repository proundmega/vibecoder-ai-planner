const crypto = require('crypto');
const { docker } = require('../utils/docker');
const AgentService = require('./AgentService');
const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');

const AGENT_IMAGE = process.env.AGENT_IMAGE || 'vibecode-agent';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
const IDLE_TIMEOUT_MS = parseInt(process.env.AGENT_IDLE_TIMEOUT_MS) || 300000;
const CONTAINER_NETWORK = process.env.CONTAINER_NETWORK || 'vibecode_default';
const REPO_VOLUME = process.env.REPO_VOLUME || 'vibecode_repos';
let _maxPoolSize = parseInt(process.env.MAX_POOL_SIZE) || 50;

function setMaxPoolSize(size) {
  _maxPoolSize = size;
}

class PoolManager {
  constructor() {
    try {
      this.docker = docker;
      this.docker.ping().catch(() => { this.docker = null; });
    } catch {
      this.docker = null;
    }
    this.pool = new Map();
    this._startCleanupInterval();
  }

  _generateAgentId() {
    return crypto.randomBytes(8).toString('hex');
  }

  _generateApiKey() {
    return 'pool-' + crypto.randomBytes(24).toString('hex');
  }

  async resolveProviderConfig(providerId) {
    const result = await pool.query(
      `SELECT provider_type, api_key_encrypted, base_url, model, max_tokens, temperature
       FROM providers WHERE id = $1 AND is_active = true`,
      [providerId]
    );

    if (result.rows.length === 0) {
      throw new Error('Provider not found or inactive');
    }

    const p = result.rows[0];
    return {
      provider_type: p.provider_type,
      api_key: p.api_key_encrypted ? decrypt(p.api_key_encrypted) : null,
      base_url: p.base_url,
      model: p.model,
      max_tokens: p.max_tokens || 4096,
      temperature: p.temperature,
    };
  }

  async autoSelectProvider() {
    let result = await pool.query(
      `SELECT provider_type, api_key_encrypted, base_url, model, max_tokens, temperature
       FROM providers WHERE is_active = true AND 'worker' = ANY(roles)
       ORDER BY created_at ASC LIMIT 1`
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT provider_type, api_key_encrypted, base_url, model, max_tokens, temperature
         FROM providers WHERE is_active = true
         ORDER BY created_at ASC LIMIT 1`
      );
    }

    if (result.rows.length === 0) {
      throw new Error('No active providers configured');
    }

    const p = result.rows[0];
    return {
      provider_type: p.provider_type,
      api_key: p.api_key_encrypted ? decrypt(p.api_key_encrypted) : null,
      base_url: p.base_url,
      model: p.model,
      max_tokens: p.max_tokens || 4096,
      temperature: p.temperature,
    };
  }

  async requestAgent(projectId, repoUrl, options = {}) {
    if (!this.docker) {
      throw new Error('Docker daemon not available. Ensure DOCKER_API_URL is configured and accessible.');
    }

    if (this.pool.size >= _maxPoolSize) {
      throw new Error(`Agent pool at max capacity (${_maxPoolSize}). No new agents can be created.`);
    }

    // Handle legacy: third arg was providerConfig object (has endpoint/apiKey/model keys)
    let resolvedOptions = options;
    if (arguments.length === 3 && typeof options === 'object' && !options.providerId && !options.repoUrl) {
      const hasLegacyKeys = 'endpoint' in options || 'apiKey' in options || 'model' in options;
      if (hasLegacyKeys) {
        // Old style: requestAgent(projectId, repoUrl, { endpoint, apiKey, model })
        resolvedOptions = { legacyProviderConfig: options };
      }
    }

    for (const [id, entry] of this.pool) {
      if (entry.state === 'idle') {
        entry.state = 'busy';
        entry.projectId = projectId;
        entry.lastActiveAt = Date.now();
        return { agentId: id, containerId: entry.containerId, reused: true };
      }
    }

    const agentId = this._generateAgentId();
    const apiKey = this._generateApiKey();

    let providerConfig = null;
    if (resolvedOptions.providerId) {
      providerConfig = await this.resolveProviderConfig(resolvedOptions.providerId);
    } else if (resolvedOptions.legacyProviderConfig) {
      // Legacy: caller passed raw provider config
      providerConfig = {
        provider_type: 'generic',
        api_key: resolvedOptions.legacyProviderConfig.apiKey || null,
        base_url: resolvedOptions.legacyProviderConfig.endpoint || null,
        model: resolvedOptions.legacyProviderConfig.model || null,
        max_tokens: 4096,
      };
    } else {
      // Auto-resolve
      providerConfig = await this.autoSelectProvider();
    }

    // Create a DB agent record so heartbeat/auth flow works the same as manual agents
    let dbAgent;
    try {
      dbAgent = await AgentService.create(
        `pool-${agentId}`,
        apiKey,
        0,
        { rateLimit: 1000, maxActionsPerDay: 10000, keyExpiryDays: 1 }
      );
    } catch (err) {
      throw new Error(`Failed to create DB record for pool agent: ${err.message}`);
    }

    const env = [
      `BACKEND_URL=${BACKEND_URL}`,
      `AGENT_API_KEY=${apiKey}`,
      `AGENT_ID=${dbAgent.id}`,
      `REPO_CLONE_DIR=/repos`,
      `AI_PROVIDER=${providerConfig.provider_type}`,
      `AI_MAX_TOKENS=${providerConfig.max_tokens}`,
    ];

    if (providerConfig.model) {
      env.push(`AI_MODEL=${providerConfig.model}`);
    }
    if (providerConfig.api_key) {
      env.push(`AI_API_KEY=${providerConfig.api_key}`);
    }
    if (providerConfig.base_url) {
      env.push(`AI_ENDPOINT_URL=${providerConfig.base_url}`);
    }

    try {
      const container = await this.docker.createContainer({
        Image: AGENT_IMAGE,
        name: `agent-${agentId}`,
        Env: env,
        HostConfig: {
          Binds: [`${REPO_VOLUME}:/repos`],
          NetworkMode: CONTAINER_NETWORK,
          AutoRemove: true,
          Memory: 2 * 1024 * 1024 * 1024,
        },
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        OpenStdin: false,
        StdinOnce: false,
      });

      await container.start();

      this.pool.set(agentId, {
        agentId,
        containerId: container.id,
        container,
        state: 'starting',
        projectId,
        ticketId: null,
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        dbAgentId: dbAgent.id,
      });

      return { agentId, containerId: container.id, reused: false, dbAgentId: dbAgent.id };
    } catch (err) {
      if (err.message && err.message.includes('No such image')) {
        throw new Error(`Agent image '${AGENT_IMAGE}' not found. Run: cd agent && docker build -t ${AGENT_IMAGE} .`);
      }
      throw err;
    }
  }

  async releaseAgent(agentId) {
    const entry = this.pool.get(agentId);
    if (!entry) throw new Error(`Agent ${agentId} not found in pool`);
    await this._destroyContainer(agentId);
    // Clean up the DB agent record
    if (entry.dbAgentId) {
      try {
        await pool.query('DELETE FROM agents WHERE id = $1', [entry.dbAgentId]);
      } catch (err) {
        // Log but don't fail — record may already be gone
        console.error(`Failed to delete DB record for pool agent ${agentId}:`, err.message);
      }
    }
  }

  getStatus() {
    const agents = [];
    let busy = 0, idle = 0, starting = 0;
    for (const [agentId, entry] of this.pool) {
      const state = entry.state;
      if (state === 'busy') busy++;
      else if (state === 'idle') idle++;
      else if (state === 'starting') starting++;
      agents.push({
        agentId,
        containerId: entry.containerId,
        state,
        ticketId: entry.ticketId,
        projectId: entry.projectId,
        startedAt: new Date(entry.startedAt).toISOString(),
        lastActiveAt: new Date(entry.lastActiveAt).toISOString(),
        uptimeSeconds: Math.floor((Date.now() - entry.startedAt) / 1000),
      });
    }
    return { agents, stats: { total: agents.length, busy, idle, starting } };
  }

  async _destroyContainer(agentId) {
    const entry = this.pool.get(agentId);
    if (!entry) return;
    try {
      await entry.container.stop({ t: 5 });
    } catch { /* already stopped */ }
    try {
      await entry.container.remove({ force: true });
    } catch { /* already removed */ }
    this.pool.delete(agentId);
  }

  _startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [agentId, entry] of this.pool) {
        if (entry.state === 'starting' && (now - entry.startedAt) > 30000) {
          this._destroyContainer(agentId);
        }
        if (entry.state === 'idle' && (now - entry.lastActiveAt) > IDLE_TIMEOUT_MS) {
          this._destroyContainer(agentId);
        }
      }
    }, 60000);
  }

  markActive(agentId) {
    const entry = this.pool.get(agentId);
    if (entry) {
      entry.lastActiveAt = Date.now();
      if (entry.state === 'starting') entry.state = 'busy';
    }
  }

  markIdle(agentId) {
    const entry = this.pool.get(agentId);
    if (entry) {
      entry.state = 'idle';
      entry.ticketId = null;
    }
  }
}

module.exports = Object.assign(new PoolManager(), { setMaxPoolSize });
