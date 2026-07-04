const crypto = require('crypto');
const { docker } = require('../utils/docker');

const AGENT_IMAGE = process.env.AGENT_IMAGE || 'vibecode-agent';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
const IDLE_TIMEOUT_MS = parseInt(process.env.AGENT_IDLE_TIMEOUT_MS) || 300000;
const CONTAINER_NETWORK = process.env.CONTAINER_NETWORK || 'vibecode_default';
const REPO_VOLUME = process.env.REPO_VOLUME || 'vibecode_repos';
let _maxPoolSize = parseInt(process.env.MAX_POOL_SIZE) || 50;
const MAX_POOL_SIZE = _maxPoolSize;

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

  async requestAgent(projectId, repoUrl, providerConfig = {}) {
    if (!this.docker) {
      throw new Error('Docker daemon not available. Ensure DOCKER_API_URL is configured and accessible.');
    }

    if (this.pool.size >= _maxPoolSize) {
      throw new Error(`Agent pool at max capacity (${_maxPoolSize}). No new agents can be created.`);
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

    const env = [
      `BACKEND_URL=${BACKEND_URL}`,
      `API_KEY=${apiKey}`,
      `AGENT_ID=${agentId}`,
      `REPO_CLONE_DIR=/repos`,
    ];
    if (providerConfig.endpoint) env.push(`AI_ENDPOINT_URL=${providerConfig.endpoint}`);
    if (providerConfig.apiKey) env.push(`AI_API_KEY=${providerConfig.apiKey}`);
    if (providerConfig.model) env.push(`AI_MODEL=${providerConfig.model}`);

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
      });

      return { agentId, containerId: container.id, reused: false };
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
