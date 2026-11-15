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
  let agentHost = null;
  let agentSandbox = null;

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
    const env = {
      ...process.env,
      COMPOSE_PROJECT_NAME: 'vibecode',
      ROOT_COMPOSE_PROJECT: 'vibecode',
    };
    root = render([composeRoot], path.dirname(composeRoot), env);
    agentHost = render([composeAgent], path.dirname(composeAgent), env);
    agentSandbox = render(
      [composeAgent, composeAgentSandbox], path.dirname(composeAgent), env);
    const failure = [root, agentHost, agentSandbox].find((result) => result.error);
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
    if (!root || !root.config || !agentHost || !agentHost.config
        || !agentSandbox || !agentSandbox.config) {
      return;
    }
    check(root.config, agentHost.config, agentSandbox.config);
  });

  rendered('binds the same repo volume that PoolManager inspects', (rootConfig) => {
    const volumeName = rootConfig.volumes.vibecode_repos.name;
    expect(volumeName).toBe('vibecode_repos');
    expect(rootConfig.services.api.environment.REPO_VOLUME).toBe(volumeName);

    const repoMount = rootConfig.services.api.volumes.find(
      (volume) => volume.target === '/repos');
    expect(repoMount).toBeDefined();
    expect(repoMount.source).toBe(volumeName);
  });

  rendered('gives pool agents a resolvable backend URL', (rootConfig, agentConfig) => {
    expect(rootConfig.services.api.environment.BACKEND_URL).toBe('http://api:3001');
    expect(agentConfig.services.agent.environment.BACKEND_URL).toBe('http://api:3001');
  });

  rendered('keeps the Docker API proxy off the default network', (rootConfig) => {
    expect(Object.keys(rootConfig.services['docker-proxy'].networks)).toEqual([
      'sandbox-control',
    ]);
    expect(rootConfig.services.api.networks).toHaveProperty('sandbox-control');
    expect(rootConfig.services.api.networks).toHaveProperty('default');
  });

  rendered('puts the proxy and PoolManager on the same internal control network', (rootConfig) => {
    const control = rootConfig.networks['sandbox-control'];
    expect(control.name).toBe(
      rootConfig.services.api.environment.SANDBOX_CONTROL_NETWORK);
    expect(control.name).toMatch(/-sandbox-control$/);
    expect(control.internal).toBe(true);
  });

  rendered('enables the proxy API sections required for sandbox lifecycle', (rootConfig) => {
    const proxyEnv = rootConfig.services['docker-proxy'].environment;
    for (const name of [
      'POST', 'CONTAINERS', 'EXEC', 'IMAGES', 'NETWORKS', 'VOLUMES',
      'ALLOW_START', 'ALLOW_STOP', 'ALLOW_RESTARTS', 'ALLOW_PAUSE',
      'ALLOW_UNPAUSE',
    ]) {
      expect(proxyEnv[name]).toBe('1');
    }
  });

  rendered('keeps standalone host mode off the proxy network', (rootConfig, hostConfig) => {
    const service = hostConfig.services.agent;
    expect(service.environment.SANDBOX_MODE).toBe('host');
    expect(service.networks).toHaveProperty('vibecode');
    expect(service.networks).not.toHaveProperty('sandbox-control');
  });

  rendered('adds the proxy network only through the Docker-mode overlay', (
    rootConfig, hostConfig, sandboxConfig
  ) => {
    const service = sandboxConfig.services.agent;
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
