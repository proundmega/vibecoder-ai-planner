const fs = require('fs');
const path = require('path');

const migrations = path.join(__dirname, '..', 'migrations');
const applySource = fs.readFileSync(path.join(migrations, 'apply.js'), 'utf8');
const sql = fs.readFileSync(path.join(migrations, '056_agent_fleet.sql'), 'utf8');
const rollback = fs.readFileSync(
  path.join(migrations, '056_agent_fleet_rollback.sql'),
  'utf8'
);

describe('agent fleet migration (FR1, FR2, FR16, NFR5)', () => {
  it('registers additive 056 after 055 and leaves the cut unregistered', () => {
    const enrollment = applySource.indexOf('055_agent_enrollment.sql');
    const fleet = applySource.indexOf('056_agent_fleet.sql');
    expect(enrollment).toBeGreaterThan(-1);
    expect(fleet).toBeGreaterThan(enrollment);
    expect(applySource).not.toContain('057_agent_fleet_clean_cut.sql');
    const cut = fs.readFileSync(
      path.join(migrations, '057_agent_fleet_clean_cut.sql'),
      'utf8'
    );
    // 056 already created runtime_id; the cut must drop, never rename, legacy.
    expect(cut).not.toMatch(/RENAME COLUMN agent_id TO runtime_id/i);
    expect(cut).not.toMatch(/RENAME COLUMN assigned_agent_id/i);
    expect(cut).toMatch(/DROP COLUMN IF EXISTS agent_id/);
  });

  it('creates the node, grant, runtime and registry schema', () => {
    for (const table of [
      'agent_nodes',
      'agent_node_grants',
      'agent_runtimes',
      'provider_credentials',
      'provider_models',
      'agent_node_enrollment_tokens',
      'agent_node_access_tokens',
      'agent_node_refresh_tokens',
      'agent_node_refresh_replays',
      'agent_node_auth_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('is additive: no destructive statements against legacy identity', () => {
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS agents/i);
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS providers/i);
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS project_providers/i);
    expect(sql).not.toMatch(/RENAME COLUMN assigned_agent_id/i);
    expect(sql).not.toMatch(/DELETE FROM harness_runs/i);
    expect(sql).not.toMatch(/UPDATE\s+harness_events/i);
  });

  it('adds runtime columns beside the legacy ones and a grants timestamp', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS assigned_runtime_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS runtime_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS runtime_id BIGINT');
    expect(sql).toMatch(/agent_node_grants \([\s\S]*created_at TIMESTAMPTZ/);
    expect(sql).toContain('uq_agent_node_grants_active');
  });

  it('drops new tables child-first on rollback and keeps legacy tables', () => {
    const runtimes = rollback.indexOf('DROP TABLE IF EXISTS agent_runtimes');
    const grants = rollback.indexOf('DROP TABLE IF EXISTS agent_node_grants');
    const models = rollback.indexOf('DROP TABLE IF EXISTS provider_models');
    const credentials = rollback.indexOf('DROP TABLE IF EXISTS provider_credentials');
    const nodes = rollback.indexOf('DROP TABLE IF EXISTS agent_nodes');
    expect(runtimes).toBeGreaterThan(-1);
    expect(grants).toBeGreaterThan(runtimes);
    expect(models).toBeGreaterThan(grants);
    expect(credentials).toBeGreaterThan(models);
    expect(nodes).toBeGreaterThan(credentials);
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS agents/);
    expect(rollback).not.toMatch(/DROP TABLE IF EXISTS providers/);
  });
});
