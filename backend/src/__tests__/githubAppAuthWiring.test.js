const fs = require('fs');
const path = require('path');
const router = require('../api/github');

function routeFor(method, routePath) {
  return router.stack
    .filter((layer) => layer.route && layer.route.path === routePath)
    .find((layer) => layer.route.methods[method]);
}

describe('GitHub App auth route wiring (fg-35 FR2/FR4/FR7)', () => {
  it('exposes an agent-authenticated token endpoint', () => {
    const layer = routeFor('post', '/:projectId/token');
    expect(layer).toBeDefined();
    expect(layer.route.stack).toHaveLength(3);
  });

  it('exposes owner-guarded installation management routes', () => {
    expect(routeFor('get', '/:projectId/installation')).toBeDefined();
    expect(routeFor('put', '/:projectId/installation')).toBeDefined();
    expect(routeFor('delete', '/:projectId/installation')).toBeDefined();
    expect(routeFor('put', '/:projectId/installation').route.stack).toHaveLength(4);
    expect(routeFor('delete', '/:projectId/installation').route.stack).toHaveLength(3);
  });

  it('documents the minimum GitHub App permissions and no admin scope', () => {
    const runbook = fs.readFileSync(
      path.join(__dirname, '../../../planning/DONE/fg-35-github-app-credentials/05_RUNBOOK.md'),
      'utf8'
    );
    for (const permission of ['contents: write', 'pull_requests: write', 'checks: read', 'metadata: read']) {
      expect(runbook).toContain(permission);
    }
    expect(runbook).toContain('Administration, actions, workflows, secrets');
    expect(runbook).toContain('**not granted**');
  });

  it('registers the installation migration and its rollback', () => {
    const migrations = path.join(__dirname, '../migrations');
    const applySource = fs.readFileSync(path.join(migrations, 'apply.js'), 'utf8');
    expect(applySource).toContain('049_project_github_installations.sql');
    expect(
      fs.existsSync(path.join(migrations, '049_project_github_installations.sql'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(migrations, '049_project_github_installations_rollback.sql'))
    ).toBe(true);
  });
});
