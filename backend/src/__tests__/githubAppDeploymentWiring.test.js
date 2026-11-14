const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

describe('GitHub App deployment wiring (fg-35 FR1/FR9)', () => {
  const names = [
    'GITHUB_AUTH_MODE',
    'ALLOW_PAT',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_TOKEN_TTL_SECONDS',
  ];

  it('forwards the App variables to the api service', () => {
    const compose = read('docker-compose.yml');
    for (const name of names) {
      expect(compose).toContain(`${name}=`);
    }
    expect(compose).toContain('GITHUB_AUTH_MODE=${GITHUB_AUTH_MODE:-app}');
    expect(compose).toContain('ALLOW_PAT=${ALLOW_PAT:-false}');
  });

  it('keeps local compose explicit about the PAT fallback', () => {
    const override = read('docker-compose.override.yml');
    expect(override).toContain('GITHUB_AUTH_MODE=${GITHUB_AUTH_MODE:-pat}');
    expect(override).toContain('ALLOW_PAT=${ALLOW_PAT:-true}');
  });

  it('documents the variables in backend/.env.example', () => {
    const example = read('backend/.env.example');
    for (const name of names) {
      expect(example).toContain(name);
    }
  });

  it('passes the auth mode flags to pool agents', () => {
    const poolManager = read('backend/src/services/PoolManager.js');
    expect(poolManager).toContain("for (const name of ['GITHUB_AUTH_MODE', 'ALLOW_PAT'])");
    expect(poolManager).toContain("SELECT owner_id FROM projects WHERE id = $1");
  });

  it('documents the private-key file mount and mapping-change revocation', () => {
    const runbook = read('planning/DONE/fg-35-github-app-credentials/05_RUNBOOK.md');
    expect(runbook).toContain('file:/run/secrets/github-app.pem');
    expect(runbook).toContain('revoke');
  });
});
