const crypto = require('crypto');
const { docker, DOCKER_URL } = require('../utils/docker');
const AgentService = require('./AgentService');
const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');
const { resolveProviderEndpoint } = require('../utils/providerDefaults');

const AGENT_IMAGE = process.env.AGENT_IMAGE || 'vibecode-agent';
const BACKEND_URL = process.env.BACKEND_URL || 'http://api:3001';
const IDLE_TIMEOUT_MS = parseInt(process.env.AGENT_IDLE_TIMEOUT_MS) || 300000;
const CONTAINER_NETWORK = process.env.CONTAINER_NETWORK || 'vibecode_default';
const SANDBOX_CONTROL_NETWORK = process.env.SANDBOX_CONTROL_NETWORK
  || 'vibecode-sandbox-control';
const REPO_VOLUME = process.env.REPO_VOLUME || 'vibecode_repos';
const REPO_MOUNT = '/repos';
let _maxPoolSize = parseInt(process.env.MAX_POOL_SIZE) || 50;

// Operator-controlled sandbox settings. The agent container receives the same
// values as the API container so a pool agent can build a Docker sandbox. No
// credential or workspace secret is included; the sandbox receives only the
// explicit SANDBOX_ENV allowlist from the agent.
const SANDBOX_ENV_NAMES = [
  'SANDBOX_MODE',
  'SANDBOX_IMAGE',
  'SANDBOX_PROXY_IMAGE',
  'SANDBOX_DOCKER_BIN',
  'SANDBOX_REQUIRE',
  'SANDBOX_REQUIRE_SECURE_FILE_ACCESS',
  'SANDBOX_CPUS',
  'SANDBOX_MEMORY_MB',
  'SANDBOX_PIDS',
  'SANDBOX_DISK_MB',
  'SANDBOX_DISK_CHECK_INTERVAL_SECONDS',
  'SANDBOX_DISK_ENFORCE',
  'SANDBOX_NOFILE',
  'SANDBOX_TMPFS_MB',
  'SANDBOX_NETWORK',
  'SANDBOX_ALLOWED_HOSTS',
  'SANDBOX_EGRESS_PROXY',
  'SANDBOX_EGRESS_UPSTREAM_NETWORK',
  'SANDBOX_EGRESS_PROBE_TIMEOUT_MS',
  'SANDBOX_EGRESS_TLS_MODE',
  'SANDBOX_EGRESS_ORIGIN_CA_HOSTS',
  'SANDBOX_EGRESS_ORIGIN_CA_B64',
  'SANDBOX_ENV',
  'SANDBOX_USER',
  'SANDBOX_ALLOW_ROOT',
  'SANDBOX_EXEC_TIMEOUT_SECONDS',
  'SANDBOX_ARTIFACT_MAX_BYTES',
  'SANDBOX_SECCOMP_PROFILE',
  'SANDBOX_APPARMOR_PROFILE',
  'SANDBOX_CONTAINER_WORKSPACE_ROOT',
  'SANDBOX_HOST_WORKSPACE_ROOT',
];

/**
 * Docker CLI address for pool agents. The API can reach the daemon through
 * DOCKER_API_URL, but the agent's docker CLI needs a DOCKER_HOST. Prefer an
 * explicit AGENT_DOCKER_HOST, then derive a TCP address from the HTTP socket
 * proxy used by the backend.
 */
function agentDockerHost() {
  const configured = process.env.AGENT_DOCKER_HOST;
  if (configured) {
    return configured;
  }
  const url = DOCKER_URL || '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      return `tcp://${parsed.hostname}:${parsed.port || 2375}`;
    } catch {
      return '';
    }
  }
  if (url.startsWith('tcp://')) {
    return url;
  }
  // A unix socket in the API container is not mounted into pool agents. Do
  // not hand them an unreachable address; Docker mode requires an explicit
  // AGENT_DOCKER_HOST (normally the socket proxy) in that setup.
  return '';
}

function sandboxModeIntent() {
  const mode = String(process.env.SANDBOX_MODE || '').trim().toLowerCase();
  const requireSandbox = String(process.env.SANDBOX_REQUIRE || '').trim().toLowerCase();
  const required = requireSandbox === 'true' || requireSandbox === '1';
  if (required && mode !== 'docker') {
    throw new Error('SANDBOX_REQUIRE=true requires SANDBOX_MODE=docker');
  }
  return { docker: mode === 'docker', mode, required };
}

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

  _parseRepo(repoUrl) {
    if (!repoUrl || typeof repoUrl !== 'string') {
      return { owner: null, name: null };
    }
    // Strip trailing slashes and .git in either order, so
    // https://github.com/acme/widgets.git/ becomes acme/widgets.
    let value = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
    const match = value.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
    if (match) {
      return { owner: match[1], name: match[2] };
    }
    const parts = value.split('/').filter(Boolean);
    if (parts.length === 2) {
      return { owner: parts[0], name: parts[1] };
    }
    return { owner: null, name: null };
  }

  _repoKey(repoUrl) {
    const repo = this._parseRepo(repoUrl);
    return repo.owner && repo.name ? `${repo.owner}/${repo.name}`.toLowerCase() : '';
  }

  _providerKey(options) {
    if (options.providerId) {
      return `id:${options.providerId}`;
    }
    if (options.legacyProviderConfig) {
      const legacy = options.legacyProviderConfig;
      const keyHash = legacy.apiKey
        ? crypto.createHash('sha256').update(legacy.apiKey).digest('hex')
        : '';
      return `legacy:${legacy.endpoint || ''}|${legacy.model || ''}|${keyHash}`;
    }
    return 'auto';
  }

  _generateApiKey() {
    return 'pool-' + crypto.randomBytes(24).toString('hex');
  }

  /**
   * Host path the Docker daemon can bind-mount for the repo volume. A bind
   * path is already daemon-visible; a named volume is resolved through the
   * daemon. Returns null when the operator must configure the path explicitly.
   */
  async _sandboxHostWorkspaceRoot() {
    const configured = process.env.SANDBOX_HOST_WORKSPACE_ROOT;
    if (configured) {
      return configured;
    }
    if (REPO_VOLUME.startsWith('/')) {
      return REPO_VOLUME;
    }
    if (!this.docker || typeof this.docker.getVolume !== 'function') {
      return null;
    }
    try {
      let info;
      try {
        info = await this.docker.getVolume(REPO_VOLUME).inspect();
      } catch (err) {
        // A fresh host has no volume until the agent bind creates it. Create
        // the named volume first so the inspected mountpoint is the same one
        // the agent will bind, rather than an empty unprefixed volume.
        if (err.statusCode !== 404 || typeof this.docker.createVolume !== 'function') {
          throw err;
        }
        await this.docker.createVolume({ Name: REPO_VOLUME });
        info = await this.docker.getVolume(REPO_VOLUME).inspect();
      }
      const mountpoint = info?.Mountpoint || info?.mountpoint;
      if (mountpoint && mountpoint.startsWith('/')) {
        return mountpoint;
      }
    } catch (err) {
      console.warn(
        `Could not resolve repo volume ${REPO_VOLUME} for sandbox mounts: ${err.message}`);
    }
    return null;
  }

  /**
   * The control network is the only path from a Docker-mode pool agent to the
   * socket proxy. Host-mode agents stay on the normal network and never
   * receive DOCKER_HOST, so repo code cannot reach the daemon.
   */
  async _ensureSandboxControlNetwork() {
    if (!this.docker || typeof this.docker.getNetwork !== 'function') {
      throw new Error('Docker daemon is required for SANDBOX_MODE=docker');
    }
    try {
      const info = await this.docker.getNetwork(SANDBOX_CONTROL_NETWORK).inspect();
      if (info && info.Internal === false) {
        throw new Error(
          `SANDBOX_CONTROL_NETWORK ${SANDBOX_CONTROL_NETWORK} must be internal`);
      }
      return;
    } catch (err) {
      if (err.statusCode !== 404) {
        throw err;
      }
    }
    try {
      await this.docker.createNetwork({
        Name: SANDBOX_CONTROL_NETWORK,
        Driver: 'bridge',
        Internal: true,
        CheckDuplicate: true,
      });
    } catch (err) {
      // A concurrent request may have created it; verify before failing.
      try {
        await this.docker.getNetwork(SANDBOX_CONTROL_NETWORK).inspect();
      } catch {
        throw err;
      }
    }
  }

  async _deletePoolAgentRecord(dbAgentId) {
    if (!dbAgentId) {
      return;
    }
    try {
      await pool.query('DELETE FROM agents WHERE id = $1', [dbAgentId]);
    } catch (err) {
      console.warn(
        `Could not delete DB record for failed pool agent ${dbAgentId}: ${err.message}`);
    }
  }

  async resolveProviderConfig(providerId) {
    const result = await pool.query(
      `SELECT provider_type, api_key_encrypted, base_url, endpoint_url,
              model, max_tokens, temperature
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
      base_url: resolveProviderEndpoint({
        providerType: p.provider_type,
        baseUrl: p.base_url,
        endpointUrl: p.endpoint_url,
      }),
      model: p.model,
      max_tokens: p.max_tokens || 4096,
      temperature: p.temperature,
    };
  }

  async autoSelectProvider() {
    let result = await pool.query(
      `SELECT provider_type, api_key_encrypted, base_url, endpoint_url,
              model, max_tokens, temperature
       FROM providers WHERE is_active = true AND 'worker' = ANY(roles)
       ORDER BY created_at ASC LIMIT 1`
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT provider_type, api_key_encrypted, base_url, endpoint_url,
                model, max_tokens, temperature
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
      base_url: resolveProviderEndpoint({
        providerType: p.provider_type,
        baseUrl: p.base_url,
        endpointUrl: p.endpoint_url,
      }),
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

    const requestedRepo = this._repoKey(repoUrl);
    const requestedProvider = this._providerKey(resolvedOptions);

    for (const [id, entry] of this.pool) {
      // A container's environment is fixed at creation time. Reusing a
      // container from another project/repo/provider would make it keep
      // polling the old project with the old credentials.
      if (entry.state === 'idle'
        && entry.projectId === projectId
        && entry.repoKey === requestedRepo
        && entry.providerKey === requestedProvider) {
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

    // Resolve Docker sandbox prerequisites before creating a DB agent or a
    // container. A Docker-mode agent without a host-visible workspace would
    // silently bind an empty directory, so fail the request instead.
    const sandboxIntent = sandboxModeIntent();
    const dockerSandbox = sandboxIntent.docker;
    let sandboxDockerHost = '';
    let sandboxHostWorkspaceRoot = null;
    let sandboxDaemonId = '';
    if (dockerSandbox) {
      sandboxDockerHost = agentDockerHost();
      if (!sandboxDockerHost) {
        throw new Error(
          'SANDBOX_MODE=docker requires AGENT_DOCKER_HOST pointing at a '
          + 'reachable socket proxy; the API unix socket is not available to '
          + 'pool agents');
      }
      sandboxHostWorkspaceRoot = await this._sandboxHostWorkspaceRoot();
      if (!sandboxHostWorkspaceRoot) {
        throw new Error(
          `SANDBOX_MODE=docker requires a host-visible repo workspace for `
          + `volume ${REPO_VOLUME}; set SANDBOX_HOST_WORKSPACE_ROOT or make `
          + 'REPO_VOLUME a host path');
      }
      await this._ensureSandboxControlNetwork();
      let daemon;
      try {
        daemon = await this.docker.info();
      } catch (err) {
        throw new Error(
          'SANDBOX_MODE=docker could not read the Docker daemon ID required '
          + `for safe stale-resource cleanup: ${err.message}`);
      }
      sandboxDaemonId = daemon?.ID || '';
      if (!sandboxDaemonId) {
        throw new Error(
          'SANDBOX_MODE=docker could not read the Docker daemon ID required '
          + 'for safe stale-resource cleanup');
      }
    }

    // Create a DB agent record so heartbeat/auth flow works the same as manual
    // agents. Own the agent by the project owner so project-scoped credential
    // and repo endpoints authorize it correctly.
    let ownerId = 0;
    try {
      const ownerResult = await pool.query(
        'SELECT owner_id FROM projects WHERE id = $1',
        [projectId]
      );
      if (ownerResult?.rows?.[0]?.owner_id != null) {
        ownerId = ownerResult.rows[0].owner_id;
      }
    } catch {
      // Keep the legacy system owner if the lookup fails; the token endpoint
      // will fail closed for an unauthorized owner.
    }

    let dbAgent;
    try {
      dbAgent = await AgentService.create(
        `pool-${agentId}`,
        apiKey,
        ownerId,
        { rateLimit: 1000, maxActionsPerDay: 10000, keyExpiryDays: 1 }
      );
    } catch (err) {
      throw new Error(`Failed to create DB record for pool agent: ${err.message}`);
    }

    const env = [
      `BACKEND_URL=${BACKEND_URL}`,
      `AGENT_API_KEY=${apiKey}`,
      `AGENT_ID=${dbAgent.id}`,
      `PROJECT_ID=${projectId}`,
      `REPO_CLONE_DIR=/repos`,
      `AI_PROVIDER=${providerConfig.provider_type}`,
      `AI_MAX_TOKENS=${providerConfig.max_tokens}`,
    ];

    if (dockerSandbox) {
      env.push(`SANDBOX_OWNER=pool-${dbAgent.id}`);
      env.push('SANDBOX_POOL_AGENT=true');
      env.push(`SANDBOX_DAEMON_ID=${sandboxDaemonId}`);
    }

    if (providerConfig.model) {
      env.push(`AI_MODEL=${providerConfig.model}`);
    }
    if (providerConfig.api_key) {
      env.push(`AI_API_KEY=${providerConfig.api_key}`);
    }
    if (providerConfig.base_url) {
      env.push(`AI_ENDPOINT_URL=${providerConfig.base_url}`);
    }

    // Pool agents need the repository to enter build mode. Accept either a
    // full URL (https://github.com/owner/repo) or owner/name.
    const repo = this._parseRepo(repoUrl);
    if (repo.owner) {
      env.push(`REPO_OWNER=${repo.owner}`);
    }
    if (repo.name) {
      env.push(`REPO_NAME=${repo.name}`);
    }

    // Harness configuration is operator-controlled. Pass it through so pool
    // agents can run the OpenCode harness exactly like manually started ones.
    // Agent-side GitHub auth mode must agree with the backend. The agent
    // fetches the actual token/PAT from the backend, so no token is put in the
    // container environment.
    for (const name of ['GITHUB_AUTH_MODE', 'ALLOW_PAT']) {
      if (process.env[name]) {
        env.push(`${name}=${process.env[name]}`);
      }
    }
    const sandboxEnv = new Map();
    for (const name of SANDBOX_ENV_NAMES) {
      if (process.env[name] !== undefined && process.env[name] !== '') {
        sandboxEnv.set(name, process.env[name]);
      }
    }

    if (dockerSandbox) {
      sandboxEnv.set('DOCKER_HOST', sandboxDockerHost);
      sandboxEnv.set('SANDBOX_HOST_WORKSPACE_ROOT', sandboxHostWorkspaceRoot);
    }
    if (!sandboxEnv.has('SANDBOX_CONTAINER_WORKSPACE_ROOT')) {
      sandboxEnv.set('SANDBOX_CONTAINER_WORKSPACE_ROOT', REPO_MOUNT);
    }
    for (const [name, value] of sandboxEnv) {
      env.push(`${name}=${value}`);
    }

    for (const name of [
      'HARNESS_MODE', 'HARNESS_BIN', 'HARNESS_STARTUP_TIMEOUT_MS',
      'HARNESS_MAX_DURATION_MINUTES',
      'HARNESS_VERIFY_COMMANDS', 'HARNESS_PROTECTED_PATHS', 'HARNESS_MODEL',
      'HARNESS_MAX_FILES', 'HARNESS_MAX_LINES', 'HARNESS_MAX_BYTES',
      'HARNESS_FSCK',
      'HARNESS_RETRY_PIN_ATTEMPTS', 'HARNESS_MAX_ATTEMPTS',
      'HARNESS_RETRY_BASE_DELAY_MS', 'HARNESS_RETRY_MAX_DELAY_MS',
    ]) {
      if (process.env[name]) {
        env.push(`${name}=${process.env[name]}`);
      }
    }

    let container;
    try {
      const createOptions = {
        Image: AGENT_IMAGE,
        name: `agent-${agentId}`,
        Env: env,
        HostConfig: {
          Binds: [`${REPO_VOLUME}:${REPO_MOUNT}`],
          NetworkMode: CONTAINER_NETWORK,
          AutoRemove: true,
          Memory: 2 * 1024 * 1024 * 1024,
        },
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        OpenStdin: false,
        StdinOnce: false,
      };
      if (dockerSandbox) {
        createOptions.Labels = {
          'vibecode.agent.owner': `pool-${dbAgent.id}`,
        };
      }

      container = await this.docker.createContainer(createOptions);
      if (dockerSandbox) {
        // Docker rejects multiple EndpointsConfig entries at create time.
        // Attach the internal control network before starting so the agent
        // never runs without proxy access.
        try {
          await this.docker.getNetwork(SANDBOX_CONTROL_NETWORK)
            .connect({ Container: container.id });
        } catch (err) {
          try {
            if (typeof container.remove === 'function') {
              await container.remove({ force: true });
            }
          } catch {
            // Best effort; the create itself failed the request.
          }
          throw new Error(
            `Could not attach pool agent to ${SANDBOX_CONTROL_NETWORK}: ${err.message}`);
        }
      }
      await container.start();

      this.pool.set(agentId, {
        agentId,
        containerId: container.id,
        container,
        state: 'starting',
        projectId,
        repoKey: requestedRepo,
        providerKey: requestedProvider,
        ticketId: null,
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        dbAgentId: dbAgent.id,
      });

      return { agentId, containerId: container.id, reused: false, dbAgentId: dbAgent.id };
    } catch (err) {
      try {
        if (container && typeof container.remove === 'function') {
          await container.remove({ force: true });
        }
      } catch {
        // Best effort; the request already failed.
      }
      await this._deletePoolAgentRecord(dbAgent.id);
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
