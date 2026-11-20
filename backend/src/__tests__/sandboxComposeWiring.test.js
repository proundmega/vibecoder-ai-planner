const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Compose wiring is the only place that knows the real volume/network names
 * after project-prefix interpolation. These assertions run the same renderer
 * Docker uses so a fresh host cannot bind an empty, differently named volume,
 * the pool agent receives a resolvable backend URL, and standalone host mode
 * cannot reach the Docker proxy by default.
 */
describe('sandbox compose wiring', () => {
  const findCompose = (relative) => {
    for (const base of [
      path.resolve(__dirname, '../../..'),
      process.cwd(),
      path.join(process.cwd(), 'compose'),
    ]) {
      const candidate = path.join(base, relative);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };
  const composeRoot = findCompose('docker-compose.yml');
  const composeAgent = findCompose('agent/docker-compose.yml');
  const composeAgentSandbox = findCompose('agent/docker-compose.sandbox.yml');
  let root = null;
  let rootOverride = null;
  let agentHost = null;
  let agentSandbox = null;

  const deploymentEnvNames = [
    'DOCKER_HOST',
    'REPO_VOLUME',
    'BACKEND_URL',
    'VIBECODE_NETWORK',
    'SANDBOX_CONTROL_NETWORK',
    'SANDBOX_MODE',
    'SANDBOX_HOST_WORKSPACE_ROOT',
    'AGENT_DOCKER_HOST',
    'REPO_HOST_PATH',
    'COMPOSE_PROJECT_NAME',
    'ROOT_COMPOSE_PROJECT',
  ];

  // Render with a fixed deployment environment so a developer shell cannot
  // change DOCKER_HOST, REPO_VOLUME, BACKEND_URL or the network names.
  const composeEnv = (overrides = {}) => {
    const env = { ...process.env };
    for (const name of deploymentEnvNames) {
      delete env[name];
    }
    env.COMPOSE_PROJECT_NAME = 'vibecode';
    env.ROOT_COMPOSE_PROJECT = 'vibecode';
    return { ...env, ...overrides };
  };

  const render = (files, cwd, env) => {
    const args = ['compose'];
    for (const file of files) {
      args.push('-f', file);
    }
    args.push('config', '--format', 'json');
    const result = spawnSync('docker', args, { cwd, env, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      return { error: result.error || new Error(result.stderr || 'compose failed') };
    }
    try {
      return { config: JSON.parse(result.stdout) };
    } catch (error) {
      return { error };
    }
  };

  beforeAll(() => {
    if (!composeRoot || !composeAgent || !composeAgentSandbox) {
      const missing = [
        !composeRoot && 'docker-compose.yml',
        !composeAgent && 'agent/docker-compose.yml',
        !composeAgentSandbox && 'agent/docker-compose.sandbox.yml',
      ].filter(Boolean).join(', ');
      throw new Error(`Could not locate compose files: ${missing}`);
    }

    // Pollute the ambient environment to prove the renderer ignores it.
    const previous = {
      DOCKER_HOST: process.env.DOCKER_HOST,
      REPO_VOLUME: process.env.REPO_VOLUME,
      BACKEND_URL: process.env.BACKEND_URL,
      VIBECODE_NETWORK: process.env.VIBECODE_NETWORK,
    };
    process.env.DOCKER_HOST = 'tcp://example.invalid:2375';
    process.env.REPO_VOLUME = '/tmp/ambient-repo';
    process.env.BACKEND_URL = 'http://ambient.invalid:1';
    process.env.VIBECODE_NETWORK = 'ambient_default';
    try {
      root = render([composeRoot], path.dirname(composeRoot), composeEnv());
      rootOverride = render(
        [composeRoot], path.dirname(composeRoot), composeEnv({ REPO_VOLUME: 'alt_repos' }));
      agentHost = render([composeAgent], path.dirname(composeAgent), composeEnv());
      agentSandbox = render(
        [composeAgent, composeAgentSandbox], path.dirname(composeAgent), composeEnv());
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    const failure = [root, rootOverride, agentHost, agentSandbox]
      .find((result) => result.error);
    if (failure) {
      if (process.env.CI) {
        throw new Error(
          `docker compose is required in CI for sandbox wiring: ${failure.error.message}`);
      }
      console.warn(
        `docker compose unavailable locally; skipping wiring assertions: ${failure.error.message}`);
    }
  });

  const rendered = (name, check) => test(name, () => {
    if (!root || !root.config || !rootOverride || !rootOverride.config
        || !agentHost || !agentHost.config
        || !agentSandbox || !agentSandbox.config) {
      return;
    }
    check(root.config, agentHost.config, agentSandbox.config, rootOverride.config);
  });

  rendered('binds the same repo volume that PoolManager inspects', (rootConfig) => {
    const volumeName = rootConfig.volumes.vibecode_repos.name;
    expect(volumeName).toBe('vibecode_repos');
    expect(rootConfig.services.api.environment.REPO_VOLUME).toBe(volumeName);

    const repoMount = rootConfig.services.api.volumes.find(
      (volume) => volume.target === '/repos');
    expect(repoMount).toBeDefined();
    const resolved = rootConfig.volumes[repoMount.source]?.name || repoMount.source;
    expect(resolved).toBe(volumeName);
  });

  rendered('keeps a custom REPO_VOLUME consistent with the API mount', (
    rootConfig, hostConfig, sandboxConfig, overrideConfig
  ) => {
    const volumeName = overrideConfig.volumes.vibecode_repos.name;
    expect(volumeName).toBe('alt_repos');
    expect(overrideConfig.services.api.environment.REPO_VOLUME).toBe(volumeName);
    const repoMount = overrideConfig.services.api.volumes.find(
      (volume) => volume.target === '/repos');
    expect(repoMount).toBeDefined();
    const resolved = overrideConfig.volumes[repoMount.source]?.name || repoMount.source;
    expect(resolved).toBe(volumeName);
  });

  rendered('gives pool agents a resolvable backend URL', (rootConfig, agentConfig) => {
    expect(rootConfig.services.api.environment.BACKEND_URL).toBe('http://api:3001');
    expect(agentConfig.services.supervisor.environment.BACKEND_URL).toBe('http://api:3001');
  });

  rendered('keeps the Docker API proxy off the default network', (rootConfig) => {
    expect(Object.keys(rootConfig.services['docker-proxy'].networks)).toEqual([
      'sandbox-control',
    ]);
    expect(rootConfig.services.api.networks).toHaveProperty('sandbox-control');
    expect(rootConfig.services.api.networks).toHaveProperty('default');
  });

  rendered('puts the proxy and PoolManager on the same internal project network', (rootConfig) => {
    const control = rootConfig.networks['sandbox-control'];
    expect(control.name).toBe(
      rootConfig.services.api.environment.SANDBOX_CONTROL_NETWORK);
    expect(control.name).toBe('vibecode-sandbox-control');
    expect(control.internal).toBe(true);
  });

  rendered('enables the proxy API sections required for sandbox lifecycle', (rootConfig) => {
    const proxyEnv = rootConfig.services['docker-proxy'].environment;
    for (const name of [
      'POST', 'CONTAINERS', 'EXEC', 'IMAGES', 'INFO', 'NETWORKS', 'VOLUMES',
      'ALLOW_START', 'ALLOW_STOP', 'ALLOW_RESTARTS', 'ALLOW_PAUSE',
      'ALLOW_UNPAUSE',
    ]) {
      expect(proxyEnv[name]).toBe('1');
    }
  });

  rendered('keeps standalone host mode off the proxy network', (rootConfig, hostConfig) => {
    const service = hostConfig.services.supervisor;
    expect(service.environment.SANDBOX_MODE).toBe('host');
    expect(service.environment.DOCKER_HOST).toBeUndefined();
    expect(service.networks).toHaveProperty('vibecode');
    expect(service.networks).not.toHaveProperty('sandbox-control');
  });

  rendered('adds the proxy network only through the Docker-mode overlay', (
    rootConfig, hostConfig, sandboxConfig
  ) => {
    const service = sandboxConfig.services.supervisor;
    expect(service.environment.SANDBOX_MODE).toBe('docker');
    expect(service.environment.DOCKER_HOST).toBe('tcp://docker-proxy:2375');
    expect(service.networks).toHaveProperty('vibecode');
    expect(service.networks).toHaveProperty('sandbox-control');

    const repoMount = service.volumes.find((volume) => volume.target === '/repos');
    expect(repoMount).toBeDefined();
    expect(repoMount.type).toBe('bind');
  });

  rendered('matches the standalone networks to the root project', (
    rootConfig, hostConfig, sandboxConfig
  ) => {
    expect(sandboxConfig.networks['sandbox-control'].name).toBe(
      rootConfig.networks['sandbox-control'].name);
    expect(hostConfig.networks.vibecode.name).toBe(
      rootConfig.networks.default.name);
  });
});
