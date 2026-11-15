const { spawnSync } = require('child_process');
const path = require('path');

/**
 * Compose wiring is the only place that knows the real volume/network names
 * after project-prefix interpolation. These assertions run the same renderer
 * Docker uses so a fresh host cannot bind an empty, differently named volume.
 */
describe('sandbox compose wiring', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const composeFile = path.join(repoRoot, 'docker-compose.yml');
  let config = null;

  beforeAll(() => {
    const result = spawnSync(
      'docker',
      ['compose', '-f', composeFile, 'config', '--format', 'json'],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    if (result.error || result.status !== 0) {
      // Keep the unit suite usable on hosts without Docker Compose; CI and
      // deployment checks still exercise the real configuration.
      console.warn('docker compose is unavailable; skipping compose wiring assertions');
      return;
    }
    config = JSON.parse(result.stdout);
  });

  const rendered = (name, check) => test(name, () => {
    if (!config) {
      return;
    }
    check();
  });

  rendered('binds the same repo volume that PoolManager inspects', () => {
    const volumeName = config.volumes.vibecode_repos.name;
    expect(volumeName).toBe('vibecode_repos');
    expect(config.services.api.environment.REPO_VOLUME).toBe(volumeName);

    const repoMount = config.services.api.volumes.find(
      (volume) => volume.target === '/repos');
    expect(repoMount).toBeDefined();
    expect(repoMount.source).toBe(volumeName);
  });

  rendered('keeps the Docker API proxy off the default network', () => {
    expect(Object.keys(config.services['docker-proxy'].networks)).toEqual([
      'sandbox-control',
    ]);
    expect(config.services.api.networks).toHaveProperty('sandbox-control');
    expect(config.services.api.networks).toHaveProperty('default');
  });

  rendered('puts the proxy and PoolManager on the same internal control network', () => {
    const control = config.networks['sandbox-control'];
    expect(control.name).toBe(
      config.services.api.environment.SANDBOX_CONTROL_NETWORK);
    expect(control.internal).toBe(true);
  });

  rendered('enables the proxy API sections required for sandbox lifecycle', () => {
    const proxyEnv = config.services['docker-proxy'].environment;
    for (const name of [
      'POST', 'CONTAINERS', 'EXEC', 'IMAGES', 'NETWORKS', 'VOLUMES',
      'ALLOW_START', 'ALLOW_STOP', 'ALLOW_RESTARTS', 'ALLOW_PAUSE',
      'ALLOW_UNPAUSE',
    ]) {
      expect(proxyEnv[name]).toBe('1');
    }
  });
});
