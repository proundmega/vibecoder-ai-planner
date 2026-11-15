const { spawnSync } = require('child_process');
const path = require('path');

/**
 * Compose wiring is the only place that knows the real volume/network names
 * after project-prefix interpolation. These assertions run the same renderer
 * Docker uses so a fresh host cannot bind an empty, differently named volume
 * and the pool agent receives a resolvable backend URL.
 */
describe('sandbox compose wiring', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const composeRoot = path.join(repoRoot, 'docker-compose.yml');
  const composeAgent = path.join(repoRoot, 'agent/docker-compose.yml');
  let root = null;
  let agent = null;

  const render = (file) => {
    const result = spawnSync(
      'docker',
      ['compose', '-f', file, 'config', '--format', 'json'],
      { cwd: path.dirname(file), encoding: 'utf8' }
    );
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
    root = render(composeRoot);
    agent = render(composeAgent);
    if (root.error || agent.error) {
      const detail = [
        root.error && `root: ${root.error.message}`,
        agent.error && `agent: ${agent.error.message}`,
      ].filter(Boolean).join('; ');
      if (process.env.CI) {
        throw new Error(`docker compose is required in CI for sandbox wiring: ${detail}`);
      }
      console.warn(`docker compose unavailable locally; skipping wiring assertions: ${detail}`);
    }
  });

  const rendered = (name, check) => test(name, () => {
    if (!root || !root.config || !agent || !agent.config) {
      return;
    }
    check(root.config, agent.config);
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

  rendered('renders a standalone agent with a host-visible repo bind', (rootConfig, agentConfig) => {
    const service = agentConfig.services.agent;
    expect(service.environment.REPO_CLONE_DIR).toBe('/repos');
    expect(service.environment.SANDBOX_MODE).toBe('host');
    expect(service.networks).toHaveProperty('vibecode');
    expect(service.networks).toHaveProperty('sandbox-control');

    const repoMount = service.volumes.find((volume) => volume.target === '/repos');
    expect(repoMount).toBeDefined();
    expect(repoMount.type).toBe('bind');
  });
});
